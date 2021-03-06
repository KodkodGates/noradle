var zlib = require('zlib')
  , zipMap = exports.zipMap = {
    'gzip' : zlib.createGzip,
    'deflate' : zlib.createDeflateRaw
  };

exports.chooseZip = function(req){
  // from the NodeJS available methods, choose the client supported method with the highest priority
  var v_zip = req;
  if (typeof req === 'object') {
    v_zips = req.headers['accept-encoding'] || '';
  }
  if (~v_zips.indexOf('gzip')) {
    return 'gzip';
  }
  if (~v_zips.indexOf('deflate')) {
    return 'deflate';
  }
};

exports.zipFilter = function(oraRes, ohdr, flags, option){
  var method = option.method
    , compress = zipMap[method]()
    ;
  ohdr['Content-Encoding'] = method;
  // todo: remember to write x-pw-gzip-ratio as trailer
  if (ohdr['Content-Length']) {
    ohdr['x-pw-content-length'] = ohdr['Content-Length'];
    delete ohdr['Content-Length'];
    ohdr['Transfer-Encoding'] = 'chunked';
  }
  oraRes.on('data', function(data){
    compress.write(data);
  });

  oraRes.on('end', function(){
    compress.end();
  });

  return compress;
};
