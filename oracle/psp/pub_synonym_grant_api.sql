create or replace public synonym st for st;
create or replace public synonym nt for nt;
create or replace public synonym tmp for tmp;
create or replace public synonym r for r;
create or replace public synonym ra for ra;
create or replace public synonym rb for rb;
create or replace public synonym u for u;
create or replace public synonym e for e;
create or replace public synonym g for g;
create or replace public synonym h for k_http;
create or replace public synonym p for k_xhtp;
create or replace public synonym t for k_type_tool;
create or replace public synonym k_gw for k_gw;
create or replace public synonym k_filter for k_filter;
create or replace public synonym ext_url_v for ext_url_v;
create or replace public synonym k_debug for k_debug;
create or replace public synonym k_sess for k_sess;
create or replace public synonym gac_cid_seq for gac_cid_seq;

grant execute on st to public;
grant execute on nt to public;
grant execute on tmp to public;
grant execute on r to public;
grant execute on ra to public;
grant execute on rb to public;
grant execute on u to public;
grant execute on e to public;
grant execute on g to public;
grant execute on k_http to public;
grant execute on k_xhtp to public;
grant execute on k_type_tool to public;
grant execute on k_gw to public;
grant execute on k_filter to public;
grant all on ext_url_v to public;
grant execute on k_debug to public;
grant execute on k_sess to public;
grant execute on gac_cid_seq to public;