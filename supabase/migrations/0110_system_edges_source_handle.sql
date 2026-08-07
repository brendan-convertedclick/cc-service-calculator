-- 0110_system_edges_source_handle.sql
-- Decision nodes and blocks now expose more than one outgoing point so a flow
-- split reads as a split. Without recording which handle an edge left from,
-- every branch snaps back to the default handle on reload and the fork
-- collapses visually. Nullable: existing edges keep React Flow's default.
alter table system_edges add column if not exists source_handle text;

comment on column system_edges.source_handle is
  'Which source handle the edge leaves from (decision: yes|no|alt, block: branch). Null = the node default (right).';
