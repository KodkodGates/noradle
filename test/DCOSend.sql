rem PL/SQL Developer Test Script

set feedback off
set autoprint off

rem Declare variables
variable tar varchar2(2000)
variable content varchar2(2000)

rem Set variables
begin
  :tar := '15620001781';
  :content := 'test h';
end;
/

rem Execute PL/SQL Block
declare
	v_amt     pls_integer := 300;
	handle    pls_integer;
	v_blb     blob;
	v_raw     raw(2000);
	v_handles nt := nt();
begin
	v_handles.extend(v_amt);
	for i in 1 .. v_amt loop
		dco.line('tj');
		dco.line(:tar);
		dco.line(:content || ' ' || i);
		v_handles(i) := dco.send_request(2, true);
		dbms_output.put_line('send ' || v_handles(i));
		-- dbms_lock.sleep(1);
	end loop;
	dco.flush;

	for i in 1 .. v_amt loop
		if dco.read_response(v_handles(i), v_blb, 11) then
			dbms_output.put_line(pdu.get_char_line);
			pdu.clear;
		else
			dbms_output.put_line('response timeout for ' || v_handles(i) || ',' || i);
		end if;
	end loop;
end;
/

rem Print variables
print tar
print content
