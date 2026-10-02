export const CALLBACK_PARTICIPANTS = [
  {id:'c242abef-c01e-490b-bab6-859cd89bd08a',name:'James Spencer',shortName:'James'},
  {id:'bf021c46-10ca-45a4-b800-08f5e181834e',name:'Erick Jackson',shortName:'Erick'},
] as const;
export const supportsCallbacks=(id?:string)=>CALLBACK_PARTICIPANTS.some(agent=>agent.id===id);
export const callbackParticipant=(id:string)=>CALLBACK_PARTICIPANTS.find(agent=>agent.id===id);
