/*
# Blank out Bland numbers for archived agents

Archived agents (William Styles, Matt Vargas, Dave Sayer) no longer need
Bland numbers in our database. Blanking them ensures no function or query
can ever accidentally route calls to their old numbers.
*/

UPDATE public.agents
SET bland_number = '',
    inbound_configured = false
WHERE status = 'archived' AND bland_number <> '';
