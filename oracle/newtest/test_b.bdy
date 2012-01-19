create or replace package body test_b is

	procedure d is
	begin
		h.status_line;
		h.content_type(charset => 'gbk');
		h.header('a', 1);
		--h.transfer_encoding_chunked;
		h.http_header_close;
	
		p.line('����һ�·�ascii�ַ�����http header�����');
		p.line(r.host_prefix);
		p.line(r.port);
		p.line(r.method);
		p.line(r.base);
		p.line(r.dad);
		p.line(r.prog);
		p.line(r.pack);
		p.line(r.proc);
		p.line(r.path);
		p.line(r.qstr);
		p.line(r.hash);
	
		p.line('<br/>');
		p.line(r.header('accept-encoding'));
	
		for i in 1 .. r.getn('count', 10) loop
			p.line('<br/>' || i);
		end loop;
	end;

	procedure long_job is
	begin
		h.status_line;
		h.content_type(mime_type => 'text/html');
		h.write_head;
		p.line('<div id="cnt"></div>');
		p.line('<script>var cnt=document.getElementById("cnt");</script>');
		p.line('<pre>');
		for i in 1 .. 9 loop
			p.line('LiNE, NO.' || i);
			p.line('<script>cnt.innerText=' || i || ';</script>');
			-- p.line(rpad(i, 300, i));
			p.flush();
			dbms_lock.sleep(1);
		end loop;
		p.line('</pre>');
	end;

	procedure form is
	begin
		h.status_line(200);
		h.content_type;
		-- p.content_type(charset => 'GBK');
		h.header('set-cookie', 'ck1=1234');
		h.header('set-cookie', 'ck3=5678');
		h.header('a', 1);
		h.header('b', 2);
		h.write_head;
	
		p.line('<a href="test_b.redirect">Link to test_b.redirect</a>');
		p.line('<form action="test_b.redirect?type=both&type=bothtoo" method="post">');
		p.line('<input name="text_input" type="text" value="http://www.google.com?q=HELLO"/>');
		p.line('����');
		p.line(utl_i18n.escape_reference('����', 'us7ascii'));
		p.flush;
		p.line('<input name="checkbox_input" type="checkbox" value="checkedvalue1" checked="true"/>');
		p.line('<input name="checkbox_input" type="checkbox" value="checkedvalue2" checked="true"/>');
		p.line('<input name="password_input" type="password" value="passwordvalue"/>');
		p.line('<input name="button1" type="submit" value="save"/>');
		p.line('</form>');
	end;

	procedure redirect is
		v_st st;
	begin
		case r.method
			when 'POST' then
				-- p.go('feedback?id=');
				h.status_line(200);
				h.content_type(mime_type => 'text/plain');
				h.write_head;
			
				p.line(r.getc('text_input'));
				p.line(r.getc('checkbox_input'));
				r.gets('checkbox_input', v_st);
				for i in 1 .. v_st.count loop
					p.line(v_st(i));
				end loop;
				p.line(r.getc('password_input'));
				p.line(r.getc('button1'));
				p.line(r.getc('type'));
				p.line(r.gets('type') (2));
			
				p.line('');
				p.line('http headers');
				p.line(r.header('accept'));
				p.line(r.header('accept-charset'));
				p.line(r.header('accept-encoding'));
				p.line(r.header('accept-language'));
				p.line(r.header('connection'));
			
				p.line('');
				p.line('cookies');
				p.line(r.cookie('ck1'));
				p.line(r.cookie('ck2'));
				p.line(r.cookie('ck3'));
				p.line(r.cookie('ck4'));
			when 'GET' then
				h.status_line(200);
				h.content_type(mime_type => 'text/plain');
				h.write_head;
			
				p.line(r.getc('text_input'));
				p.line(r.getc('checkbox_input'));
				r.gets('checkbox_input', v_st);
				for i in 1 .. v_st.count loop
					p.line(v_st(i));
				end loop;
				return;
			
				h.status_line(303);
				h.location('test_b.d');
				h.write_head;
			else
				h.status_line(200);
				h.content_type;
				h.write_head;
				p.line('Method (' || r.method || ') is not supported');
		end case;
	end;

end test_b;
/