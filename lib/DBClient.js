/**
 * Created by cuccpkfs on 15-2-4.
 */
var net = require('net')
  , sys_cfg = require('./cfg.js')
  , debug = require('debug')('noradle:DBPool')
  , C = require('./constant.js')
  , find = require('./util/util.js').find
  , logRegular = false
  , Request = require('./Request.js')
  , util = require('util')
  , cfgOverride = require('./util/util.js').override
  , events = require("events")
  ;

var EMPTY = 0
  , FREE = 1
  , BUSY = 2
  , FREEING = 3
  , CLOSED = 4
  , ERROR = 5
  , QUITTING = 6
  ;

/**
 * parse db names and session info from head of oraSock
 * @param data Buffer
 * @constructor
 */
function OraSockAttrSet(data){
  var dbNamesLen = data.readInt32BE(32)
    , dbNames = data.slice(36).toString().split('/')
    ;

  this.name = dbNames[0];
  this.domain = dbNames[1];
  this.uniqueName = dbNames[2];
  this.role = dbNames[3];

  this.oraSid = data.readInt32BE(4);
  this.oraSerial = data.readInt32BE(8);
  this.oraSpid = data.readInt32BE(12);
  this.slotID = data.readInt32BE(16);
  this.stime = Date.now();
  this.lifeMin = data.readInt32BE(20);
  this.reqCnt = data.readInt32BE(24);
  this.instance = data.readInt32BE(28);
}

/** called when a slot first created on first arrival of OSP connection */
function Slot(c, oraSockAttrSet, dbPool){
  // properties below has statistics
  this.hBytesRead = 0;
  this.hBytesWritten = 0;
  this.sockCount = 0;
  this.reqCount = 0;
  this.reqTimeAccum = 0; // ms
  this.bindSock(c, oraSockAttrSet);
  // properties below has value only when
  this.bTime = undefined;
  this.env = undefined;
  this.response = undefined;
  this.dbPool = dbPool;
  this.readQuit = Slot.prototype.readQuit.bind(this);
}
/** called when OSP connect to DBPool */
Slot.prototype.bindSock = function(oraSock, oraSockAttrSet){
  this.oraSock = oraSock;
  this.oraSockAttrSet = oraSockAttrSet;
  this.slotID = oraSockAttrSet.slotID;
  this.status = FREE;
  logRegular && this.log();
  logRegular && (debug((this.sockCount === 0) ? 'new slot and new oraSock' : 'reuse slot and new oraSock'));
  this.sockCount++;
};
/** if got data on FREE status, it must be quit signal from OSP */
Slot.prototype.readQuit = function(){
  var slot = this;
  if (slot.status === FREE) {
    slot.quit();
    slot.log();
    debug(' got quitting signal on free sts!');
    slot.oraSock.read();
  } else {
    slot.log();
    console.error(new Date(), ' got quitting signal on not free sts!', slot.status, slot.oraSock.read());
  }
};
/** mark slot busy */
Slot.prototype.goBusy = function(env){
  this.status = BUSY;
  this.reqCount++;
  this.env = env;
  this.bTime = Date.now();
  this.response = false;
  this.overtime = false;
  this.dbPool.busySet[this.slotID] = this;
  this.oraSock.removeListener('readable', this.readQuit);
  logRegular && this.log();
  logRegular && debug('req#%d socket go busy', this.reqCount);
};
/** mark slot free, return back to dbPool's freeList */
Slot.prototype.goFree = function(){
  var slot = this
    , slotID = this.slotID
    , dbPool = this.dbPool
    ;
  this.reqTimeAccum += (Date.now() - this.bTime);
  logRegular && slot.log();
  logRegular && debug('req#%d socket go free', slot.reqCount);
  delete dbPool.busySet[slotID];
  // WHEN from BUSY to QUITTING
  if (slot.status === QUITTING) {
    slot.log();
    debug(' got quitting signal tight after previous request!');
    return;
  }
  logRegular && this.log();
  logRegular && debug('req#%d socket go free', this.reqCount);
  slot.status = FREE;
  dbPool.freeList.unshift(slotID);
  if (!dbPool.execQueuedCB()) {
    slot.oraSock.on('readable', slot.readQuit);
  }
};
Slot.prototype.quit = function(freeList){
  var freeList = this.dbPool.freeList
    , pos = freeList.indexOf(this.slotID)
    ;
  if (pos >= 0) {
    freeList.splice(pos, 1);
  }
  this.status = QUITTING;
};
Slot.prototype.releaseSock = function(cause){
  var slotID = this.slotID
    , oraSock = this.oraSock
    , dbPool = this.dbPool
    ;
  if (!oraSock) {
    this.log();
    debug(' socket release from pool repeatly');
    return;
  }
  logRegular && this.log();
  logRegular && debug(' socket release from pool');

  this.hBytesRead += oraSock.bytesRead;
  this.hBytesWritten += oraSock.bytesWritten;
  oraSock.removeAllListeners();

  switch (this.status) {
    case FREE:
      logRegular && debug(' release from freeList');
      var freeList = dbPool.freeList;
      freeList.splice(find(freeList, slotID), 1);
      break;
    case FREEING:
      delete dbPool.busySet[slotID];
      break;
    case BUSY:
      delete dbPool.busySet[slotID];
      dbPool.waitTimeoutStats.busyEnd++;
      this.log();
      debug(' release from busyList', cause, this.status);
      oraSock.emit('socket_released', Date.now() - this.bTime);
      break;
    case QUITTING:
      this.log();
      debug(' release from quitting', cause, this.status);
      break;
    default:
      this.log();
      debug('quit connection not in ether free/freeing/busy state!', cause, this.status);
  }

  this.oraSock = undefined;
  this.status = CLOSED;
  oraSock.end();
};
Slot.prototype.log = function(){
  var o = this.oraSockAttrSet;
  debug('\npool slot (#%d - %d:%d) of %d @%s.%s', o.slotID, o.oraSid, o.oraSerial, 0, o.name, o.domain);
};

function DBPool(port, cfg){
  this.slots = [];
  this.freeList = [];
  this.busySet = {};
  this.waitQueue = [];
  this.waitTimeoutStats = {
    conn : 0,
    resp : 0,
    fin : 0,
    busyEnd : 0,
    cancel : 0
  };
  if (port instanceof Array) {
    // params: from DBPool.connect(address,amount,cfg)
    this.address = arguments[0];
    this.amount = arguments[1];
    this.cfg = cfgOverride(sys_cfg, arguments[2] || {});
    this.keep = true;
    DBPool.pools[this.address.join(":")] = this;
  } else {
    this.port = port || 1522;
    this.cfg = cfgOverride(sys_cfg, cfg || {});
    this.listen();
    this.checkInterval();
    DBPool.pools[this.port] = this;
  }
}

DBPool.pools = {};

DBPool.prototype.listen = function(){
  var port = this.port
    , me = this
    ;
  var dbListener = net.createServer({allowHalfOpen : true}, function(c){
    me.onConnectForDBPool(c);
  });

  dbListener.listen(port, function(){
    debug('NodeJS server is listening for oracle connection at port ' + port);
  });
};

DBPool.connect = function(address, amount, cfg){
  debug('DBPool.connect', address, amount, cfg);
  amount = amount || 1;
  var dbPool = new DBPool(address, amount, cfg)
    , actualAmount = 0
    ;

  for (var i = 0; i < amount; i++) {
    connect(i);
  }

  return dbPool;

  function connect(i){
    var cliSock
      , retryDelay = 0
      ;

    one();

    function one(){
      if (i >= dbPool.amount) return;
      debug('do connect %s', i);
      cliSock = net.connect.apply(net, address);
      cliSock.on('connect', onConnect);
      cliSock.on('error', onEndError);

      function onConnect(){
        debug('connected to %s', i);
        cliSock.removeListener('error', onEndError);
        cliSock.on('end', onEndError);
        dbPool.onConnectForDBPool(cliSock, function(){
          retryDelay = 0;
        });
        actualAmount++;
      }

      function onEndError(err){
        if (err) {
          debug('got connect error to %s, %s', i, retryDelay, err);
        } else {
          debug('got disconnected to %s', i, retryDelay);
          actualAmount--;
        }
        if (!dbPool.keep) {
          return;
        }
        if (retryDelay) {
          setTimeout(one, retryDelay * 1000);
          if (retryDelay < 64) {
            retryDelay *= 2;
          }
        } else {
          one();
          retryDelay = 1;
        }
      }
    }
  }
};

DBPool.prototype.disconnect = function(){
  this.keep = false;
  this.slots.forEach(function(slot){
    slot.oraSock.end();
  });
};

DBPool.prototype.onConnectForDBPool = function(c, cb){
  var me = this
    , slots = me.slots
    , freeList = me.freeList
    , cfg = me.cfg
    ;
  {
    var slot, slotID, oraSockAttrSet;

    (function(){
      var head, chunks = [];
      c.on('readable', onHandshake);

      function onHandshake(){
        var data = c.read();

        if (data === null) {
          debug('null data on hand-shake found');
          return;
        }

        if (!chunks.length) {
          try {
            var ptoken = data.readInt32BE(0);
          } catch (e) {
            ptoken = -1;
          }
          if (ptoken !== 197610261) {
            if (ptoken === 197610262) {
              // not free oracle process
              debug('no free oracle connection available');
              //c.end();
              //c.destroy();
            } else {
              console.warn('none oracle connection attempt found', data);
              c.end();
              c.destroy();
            }
            return;
          }
        }

        while (data.length < 7) {
          if (chunks.length === 0) break;
          data = Buffer.concat([chunks.pop(), data]);
        }
        chunks.push(data);

        if (data.slice(-7).toString('ascii') !== '/080526') {
          debug('partial oracle connect data', data, data.slice(36), data.slice(36).toString());
          return;
        }
        head = Buffer.concat(chunks);
        c.removeListener('readable', onHandshake);

        oraSockAttrSet = new OraSockAttrSet(head);
        debug(oraSockAttrSet);
        slotID = oraSockAttrSet.slotID;
        init();
        cb && cb();
      }
    })();

    function init(){
      slot = slots[slotID];
      if (slot) {
        if (slot.oraSock) {
          // if broken connection is still holding and in use, release it for replacement of new connection
          debug(' slot replacement with new socket');
          slot.releaseSock('override');
          // slot.oraSock.destroy();
        }
        slot.bindSock(c, oraSockAttrSet);
      } else {
        slot = slots[slotID] = new Slot(c, oraSockAttrSet, me);
      }

      freeList.push(slotID);
      if (!me.execQueuedCB()) {
        slot.oraSock.on('readable', slot.readQuit);
      }

      c.on('end', function(){
        if (slot.oraSock !== c) {
          slot.log();
          debug(' socket fin received but slot.oraSock is not the same one');
          return;
        }
        logRegular && slot.log();
        logRegular && debug(' socket fin received');
        slot.releaseSock('on_end');
      });
      c.on('error', function(err){
        slot.log();
        debug(' socket error', err);
        slot.releaseSock('on_error');
      });
      if (cfg.oracle_keep_alive) {
        c.setKeepAlive(true, 1000 * cfg.oracle_keep_alive);
      } else {
        c.setKeepAlive(false);
      }
    }
  }
}

function Interrupter(dbPool, env, dbSelector, cb){
  events.EventEmitter.call(this);
  this.dbPool = dbPool;
  this.env = env;
  this.cb = cb;
  this.aborted = false;
  this.overtime = false;
  this.sTime = Date.now();
}
util.inherits(Interrupter, events.EventEmitter);
Interrupter.prototype.abort = function(){
  debug(this.env, 'aborted, catched by db.js');
  this.aborted = true;
  var waitQueue = this.dbPool.waitQueue;
  var index = find(waitQueue, this);
  if (index >= 0) {
    debug(this.env, 'interrupted when waiting');
    waitQueue.splice(index, 1);
  }
};

/** got a request object to send request and receive response
 dbPool.findFree(env, dbSelector, function(err, request) {
   request.init(PROTOCOL, hprof);
   request.addHeaders(...);
   request.end(function(response){
     response.status;
     response.headers;
     response.on('data', function(data){...});
     response.on('end', function(){...});
   });
 });
 */
DBPool.prototype.findFree = function(env, dbSelector, cb, interrupter){
  var freeList = this.freeList
    , busySet = this.busySet
    , waitQueue = this.waitQueue
    ;
  if (interrupter) {
    // in the case of called from later queue
    if (interrupter.aborted) {
      cb(new Error('request aborted'));
      return;
    }
    if (interrupter.overtime) {
      cb(new Error('request wait db connection timeout'));
      return;
    }
  } else {
    interrupter = new Interrupter(this, env, dbSelector, cb);
  }
  if (freeList.length > 0) {
    var slotID = freeList.shift()
      , slot = this.slots[slotID]
      , oraSock = slot.oraSock
      , req = new Request(oraSock, env)
      ;
    slot.goBusy(env);
    req.on('response', function(res){
      slot.response = true;
    });
    cb(null, req);

    req.on('fin', function(){
      if (req.quitting) {
        slot.status = QUITTING;
      }
      slot.goFree();
    });

    req.on('error', function(){
      if (slotID in busySet) {
        delete busySet[slotID];
        slot.status = ERROR;
      } else {
        console.warn('None busy oraSock is used in db.reportProtocolError !');
      }
      slot.goFree();
    });
  } else {
    waitQueue.push(interrupter);
    logRegular && debug('later push', waitQueue.length);
  }
  return interrupter;
};

DBPool.prototype.execQueuedCB = function(){
  var waitQueue = this.waitQueue
    ;
  while (true) {
    var w = waitQueue.shift();
    if (!w) {
      return false;
    }
    if (w.aborted) {
      debug(w.env, 'abort in later queue');
      ;
      continue;
    }
    debug('executing a wait queue item', waitQueue.length);
    this.findFree(w.env, w.dbSelector, w.cb, w);
    return true;
  }
}

// database connection pool monitor
DBPool.prototype.checkInterval = function(){
  var dbPool = this
    , cfg = dbPool.cfg
    , waitTimeoutStats = this.waitTimeoutStats
    , slots = this.slots
    , busySet = this.busySet
    , waitQueue = this.waitQueue
    ;
  setInterval(function(){
    var now = Date.now()
      ;
    //check for long running busy oraSocks, and emit LongRun event for killing, alerting, and etc ...
    for (var slotID in busySet) {
      var slot = slots[slotID]
        , oraSock = slot.oraSock
        ;
      if (slot.overtime === false && now - slot.bTime > cfg.ExecTimeout) {
        if (slot.response) {
          // todo: find too long executions that has header returned, timeout it
          // it may use chunked transfer
        } else {
          waitTimeoutStats.resp++;
          slot.overtime = true;
          slot.log();
          debug('response_timeout by interval checker', now - slot.bTime);
          // todo: execute longer than 3s, may do alert, and kill the oracle session
        }
      }
    }

    // check if task wait too long, yes to call timeout callback and remove from wait queue
    // low index item is waiting longer
    for (var i = waitQueue.length - 1; i >= 0; i--) {
      var w = waitQueue[i]
        ;
      if (w.overtime === false && now - w.sTime > cfg.FreeConnTimeout) {
        waitTimeoutStats.conn++;
        w.overtime = true;
        // later.splice(i, 1);
        debug('wait free oraSock timeout by interval checker', now - w.sTime);
      }
    }
  }, cfg.DBPoolCheckInterval);
};

DBPool.getFirstPool = function(){
  return DBPool.pools[Object.keys(DBPool.pools)[0] || 0];
};

exports.DBPool = DBPool;

/*
 * todo:
 */