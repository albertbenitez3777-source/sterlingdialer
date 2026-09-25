export const adminSections = [
 {id:'dashboard',label:'Home',hint:'Start here: call controls and your team.'},
 {id:'monitoring',label:'Team Monitor',hint:'Login time, agent-made calls, transfers and callbacks by agent.'},
 {id:'calls',label:'Call History',hint:'Review call outcomes, transcripts and available recordings.'},
 {id:'opportunities',label:'Callbacks',hint:'Review people flagged for follow-up. Team Monitor tracks unreturned transfers separately.'},
 {id:'contacts',label:'Find a Client',hint:'Search saved client information and open a record.'},
 {id:'saved',label:'Saved Transfers',hint:'Review transfers saved by agents, including removed entries.'},
 {id:'leads',label:'Add Leads',hint:'Upload a lead list. Review the file before importing.'},
 {id:'extra',label:'Client Research',hint:'Prepare optional external searches from information you provide.'},
 {id:'system',label:'Settings & Reports',hint:'Detailed call statistics, team settings and diagnostics.'},
 {id:'test',label:'Test Calls',hint:'Place a real test call only when you choose to start one.'},
];
export const adminSection = (id:string) => adminSections.find(s=>s.id===id);
