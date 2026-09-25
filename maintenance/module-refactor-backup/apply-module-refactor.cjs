const guardFs=require("fs");if(guardFs.readFileSync("src/App.tsx","utf8")!==JSON.parse(guardFs.readFileSync("module-source.json","utf8"))["src/App.tsx"])throw Error("Current source changed; refresh snapshot first");

{
const fs = require('fs');
const path = require('path');
const ts = require('./node_modules/typescript');
const root = path.resolve('.');
const original = JSON.parse(fs.readFileSync('module-source.json','utf8'))['src/App.tsx'];
const sf = ts.createSourceFile('App.tsx',original,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const app = sf.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='App');
const txt=n=>n.getText(sf);
const imports=sf.statements.filter(ts.isImportDeclaration).map(txt).join('\n');
const other=sf.statements.filter(n=>!ts.isImportDeclaration(n)&&n!==app);
function names(n) { if(ts.isIdentifier(n))return [n.text]; if(ts.isObjectBindingPattern(n)||ts.isArrayBindingPattern(n))return n.elements.flatMap(e=>ts.isBindingElement(e)?names(e.name):[]);return []; }
const named=n=>ts.isVariableStatement(n)?n.declarationList.declarations.flatMap(d=>names(d.name)):n.name?[n.name.text]:[];
const sharedNames=other.flatMap(named);
function write(file,body){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),body+'\n');}
write('src/app/shared.tsx',imports+'\n'+other.map(n=>'export '+txt(n)).join('\n\n'));
const common=imports+'\nimport { '+sharedNames.join(', ')+' } from "@/app/shared";\n';
const statements=[...app.body.statements];
const loginGuards=statements.filter(n=>ts.isIfStatement(n)&&(/^(ownerNeedsSetup|!session\?\.valid)$/.test(txt(n.expression))));
const mainReturn=statements.findLast(ts.isReturnStatement);
const derived=statements.filter(n=>ts.isVariableStatement(n)&&named(n).some(k=>['isOwner','isStrictOwner','canControl','navItems'].includes(k)));
const localNames=statements.filter(ts.isVariableStatement).flatMap(named);
const ids=s=>{const f=ts.createSourceFile('part.tsx',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const out=new Set();function walk(n){if(ts.isIdentifier(n)&&localNames.includes(n.text))out.add(n.text);ts.forEachChild(n,walk);}walk(f);return [...out];};
const used=new Set(['session','ownerNeedsSetup','isOwner','isStrictOwner','sessionToken','atomicLogout']);
function component(file,name,jsx,auth=false,extra=''){
 const needed=ids(jsx);needed.forEach(n=>used.add(n));
 const guard=!auth&&needed.includes('session')?'if (!session?.valid) return null;\n':'';
 write(file,common+'import type { ApplicationModel } from "@/app/useApplicationModel";\n'+extra+'\nexport function '+name+'({ model }: { model: Pick<ApplicationModel, '+needed.map(n=>JSON.stringify(n)).join(' | ')+' > }) {\nconst { '+needed.join(', ')+' } = model;\n'+guard+(auth?jsx:'return (<>\n'+jsx+'\n</>);')+'\n}');
}
function find(pred){let found;function walk(n){if(pred(n))found=n;else ts.forEachChild(n,walk);}walk(mainReturn);if(!found)throw Error('missing JSX');return found;}
function classIs(n,c){return ts.isJsxElement(n)&&n.openingElement.attributes.properties.some(p=>ts.isJsxAttribute(p)&&p.name.text==='className'&&p.initializer&&ts.isStringLiteral(p.initializer)&&p.initializer.text===c);}
const content=find(n=>classIs(n,'content-wrap'));
const owner=[],agent=[],shared=[];
for(const child of content.children){if(!ts.isJsxExpression(child)||!child.expression)continue;const s=txt(child);if(/^\{isOwner\s*&&/.test(s))owner.push(s);else if(/^\{!isOwner\s*&&/.test(s))agent.push(s);else shared.push(s);}
component('src/modules/owner/OwnerDashboard.tsx','OwnerDashboard',owner.join('\n'));
component('src/modules/agent/AgentWorkspace.tsx','AgentWorkspace',agent.join('\n'));
component('src/app/SharedWorkspace.tsx','SharedWorkspace',shared.join('\n'));
component('src/modules/login/LoginScreen.tsx','LoginScreen',loginGuards.map(txt).join('\n')+'\nreturn null;',true);
const header=find(n=>ts.isJsxElement(n)&&txt(n.openingElement.tagName)==='header');
const status=find(n=>classIs(n,'topbar f1-status-strip'));
component('src/modules/navigation/MainNavigation.tsx','MainNavigation',txt(header));
component('src/modules/navigation/StatusBar.tsx','StatusBar',txt(status));
const chat=find(n=>ts.isJsxSelfClosingElement(n)&&txt(n.tagName)==='WhatsUp');
const phone=find(n=>ts.isJsxExpression(n)&&txt(n).startsWith('{!isStrictOwner && <IPhone'));
const camera=find(n=>ts.isJsxSelfClosingElement(n)&&txt(n.tagName)==='CameraWidget');
component('src/modules/chat/ChatModule.tsx','ChatModule',txt(chat));
component('src/modules/phone/PhoneModule.tsx','PhoneModule',txt(phone));
component('src/modules/camera/CameraModule.tsx','CameraModule',txt(camera));
const shell=find(n=>classIs(n,'app-shell f1-v2-shell'));
const modal=shell.children.filter(n=>ts.isJsxExpression(n)&&n.expression&&n!==phone);
component('src/app/WorkspaceDialogs.tsx','WorkspaceDialogs',modal.map(txt).join('\n'));
// Session state and authentication effects move together, retaining the exact protocol.
const authNames=['session','pin','loginError','loggingIn','loginInFlight','sessionToken','ownerNeedsSetup','setupPin','setupConfirm','setupError','settingUp'];
const authState=statements.filter(n=>ts.isVariableStatement(n)&&named(n).some(k=>authNames.includes(k)));
const authBindings=authState.flatMap(named);
const authEffects=statements.filter(n=>ts.isExpressionStatement(n)&&txt(n).startsWith('useEffect(')&&/action: '(owner_needs_setup|verify|login_by_token)'/.test(txt(n)));
const handlers=statements.filter(n=>ts.isVariableStatement(n)&&named(n).some(k=>['handleLogin','handleLogout','handleOwnerSetup'].includes(k)));
const deps=['setAgentAvailable','setActiveNav','setShowOfflineModal','atomicLogout'];
write('src/modules/login/useLoginSession.ts',common+`\nimport type { Dispatch, SetStateAction } from 'react';
export function useLoginState() {\n${authState.map(txt).join('\n')}\nreturn {${authBindings.join(',')}};\n}
type LoginState = ReturnType<typeof useLoginState>;
type LoginLifecycle = LoginState & { setAgentAvailable: Dispatch<SetStateAction<boolean>>; setActiveNav: Dispatch<SetStateAction<string>>; setShowOfflineModal: Dispatch<SetStateAction<boolean>>; atomicLogout: () => void; };
export function useLoginLifecycle({${[...authBindings,...deps].join(',')}}: LoginLifecycle) {\n${authEffects.map(txt).join('\n')}\n${handlers.map(txt).join('\n')}\nreturn { handleLogin, handleLogout, handleOwnerSetup };\n}`);
const omitted=new Set([...authState,...authEffects,...handlers,...loginGuards,...derived,mainReturn]);
let model=statements.filter(n=>!omitted.has(n)).map(txt).join('\n\n');
// Lifecycle must run after atomicLogout and before any render return, on every render.
model=model.replace('atomicLogoutRef.current = atomicLogout;',`atomicLogoutRef.current = atomicLogout;\nconst { handleLogin, handleLogout, handleOwnerSetup } = useLoginLifecycle({ ...login, ${deps.join(',')} });`);
const derivedCode=derived.map(txt).join('\n').replaceAll('session.agent?', 'session?.agent?');
write('src/app/useApplicationModel.ts',common+'import { useLoginState, useLoginLifecycle } from "@/modules/login/useLoginSession";\nexport function useApplicationModel() {\nconst login = useLoginState();\nconst { '+authBindings.join(',')+' } = login;\n'+model+'\n'+derivedCode+'\nreturn { '+[...used].join(',')+' };\n}\nexport type ApplicationModel = ReturnType<typeof useApplicationModel>;');
write('src/App.tsx',`import { useApplicationModel } from '@/app/useApplicationModel';
import { LoginScreen } from '@/modules/login/LoginScreen';
import { MainNavigation } from '@/modules/navigation/MainNavigation';
import { StatusBar } from '@/modules/navigation/StatusBar';
import { OwnerDashboard } from '@/modules/owner/OwnerDashboard';
import { AgentWorkspace } from '@/modules/agent/AgentWorkspace';
import { SharedWorkspace } from '@/app/SharedWorkspace';
import { WorkspaceDialogs } from '@/app/WorkspaceDialogs';
import { PhoneModule } from '@/modules/phone/PhoneModule';
import { ChatModule } from '@/modules/chat/ChatModule';
import { CameraModule } from '@/modules/camera/CameraModule';
import { ModuleBoundary } from '@/app/ModuleBoundary';
import { MatrixField } from '@/components/MatrixField';

export default function App() {
 const model = useApplicationModel();
 if (model.ownerNeedsSetup || !model.session?.valid) return <LoginScreen model={model} />;
 return <>
  <div className="app-shell f1-v2-shell">
   <MatrixField density="ops" />
   <ModuleBoundary name="Navigation"><MainNavigation model={model} /></ModuleBoundary>
   <div className="content-area">
    <ModuleBoundary name="Status"><StatusBar model={model} /></ModuleBoundary>
    <div className="content-wrap">
     <ModuleBoundary name="Workspace tools"><SharedWorkspace model={model} /></ModuleBoundary>
     <ModuleBoundary name="Workspace" resetKey={model.isOwner ? 'owner' : 'agent'}>
      {model.isOwner ? <OwnerDashboard model={model} /> : <AgentWorkspace model={model} />}
     </ModuleBoundary>
    </div>
   </div>
   <ModuleBoundary name="Dialogs"><WorkspaceDialogs model={model} /></ModuleBoundary>
   <ModuleBoundary name="Chat"><ChatModule model={model} /></ModuleBoundary>
   <ModuleBoundary name="Phone"><PhoneModule model={model} /></ModuleBoundary>
  </div>
  <ModuleBoundary name="Camera"><CameraModule model={model} /></ModuleBoundary>
 </>;
}`);
console.log('Extracted modules; model exposes',used.size,'existing values');

}

{
const fs=require('fs'),path=require('path'),ts=require('./node_modules/typescript');
const root=path.resolve('.');
const file=path.join(root,'src/app/shared.tsx'),source=fs.readFileSync(file,'utf8');
const sf=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function hasJsx(n){if(ts.isJsxElement(n)||ts.isJsxSelfClosingElement(n)||ts.isJsxFragment(n))return true;return !!ts.forEachChild(n,hasJsx);}
const views=sf.statements.filter(n=>ts.isFunctionDeclaration(n)&&hasJsx(n));
const imports=sf.statements.filter(ts.isImportDeclaration).map(n=>n.getText(sf)).join('\n');
const remaining=sf.statements.filter(n=>!ts.isImportDeclaration(n)&&!views.includes(n));
const sharedNames=remaining.flatMap(n=>n.name?[n.name.text]:ts.isVariableStatement(n)?n.declarationList.declarations.map(d=>d.name.getText(sf)):[]);
fs.writeFileSync(file,imports+'\n'+remaining.map(n=>n.getText(sf)).join('\n\n'));
for(const view of views){
 fs.mkdirSync(path.join(root,'src/app/views'),{recursive:true});
 fs.writeFileSync(path.join(root,'src/app/views',view.name.text+'.tsx'),imports+'\nimport { '+sharedNames.join(',')+' } from "@/app/shared";\n'+views.filter(v=>v!==view).map(v=>'import { '+v.name.text+' } from "@/app/views/'+v.name.text+'";').join('\n')+'\n'+view.getText(sf)+'\n');
}
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(/\.tsx?$/.test(p)&&!p.includes('/app/views/')&&p!==file){let s=fs.readFileSync(p,'utf8');s=s.replace(/import \{([^}]+)\} from ["']@\/app\/shared["'];?/g,(whole,list)=>{const entries=list.split(',').map(x=>x.trim());const found=views.filter(v=>entries.includes(v.name.text));if(!found.length)return whole;const keep=entries.filter(x=>!found.some(v=>v.name.text===x));return (keep.length?'import { '+keep.join(', ')+' } from "@/app/shared";\n':'')+found.map(v=>'import { '+v.name.text+' } from "@/app/views/'+v.name.text+'";').join('\n');});fs.writeFileSync(p,s);}}}
walk(path.join(root,'src'));
console.log('Separated',views.length,'shared views');

}

{
const fs = require('fs');
const path = require('path');
const ts = require('./node_modules/typescript');
const root = path.resolve('.');
const config = ts.readConfigFile(path.join(root,'tsconfig.app.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const host = {
 getScriptFileNames: () => parsed.fileNames,
 getScriptVersion: () => '0',
 getScriptSnapshot: f => fs.existsSync(f) ? ts.ScriptSnapshot.fromString(fs.readFileSync(f,'utf8')) : undefined,
 getCurrentDirectory: () => root,
 getCompilationSettings: () => parsed.options,
 getDefaultLibFileName: ts.getDefaultLibFilePath,
 fileExists: ts.sys.fileExists, readFile: ts.sys.readFile, readDirectory: ts.sys.readDirectory,
};
const service=ts.createLanguageService(host);
for (const fileName of parsed.fileNames.filter(f=>f.includes('/src/app/')||f.includes('/src/modules/')||f.endsWith('/src/App.tsx'))) {
 const edits=service.organizeImports({type:'file',fileName},{},{});
 for (const edit of edits) {
  let source=fs.readFileSync(edit.fileName,'utf8');
  for (const e of [...edit.textChanges].sort((a,b)=>b.span.start-a.span.start)) source=source.slice(0,e.span.start)+e.newText+source.slice(e.span.start+e.span.length);
  fs.writeFileSync(edit.fileName,source);
 }
}
console.log('Organized module imports');

}

require("fs").writeFileSync("src/app/ModuleBoundary.tsx","import { Component,type ErrorInfo,type ReactNode } from 'react';\n\ntype Props = { name: string; resetKey?: string; children: ReactNode };\ntype State = { failed: boolean };\n\n/** A view failure must not unmount another module's ongoing conversation. */\nexport class ModuleBoundary extends Component<Props, State> {\n  state: State = { failed: false };\n\n  static getDerivedStateFromError(): State { return { failed: true }; }\n\n  componentDidCatch(_error: Error, _info: ErrorInfo) {\n    // Do not log component props, which can include private session/contact data.\n    console.error(`Federal One: ${this.props.name} could not render.`);\n  }\n\n  componentDidUpdate(previous: Props) {\n    if (this.state.failed && previous.resetKey !== this.props.resetKey) {\n      this.setState({ failed: false });\n    }\n  }\n\n  render() {\n    if (!this.state.failed) return this.props.children;\n    return <section className=\"glass-card\" role=\"alert\" aria-label={`${this.props.name} unavailable`}>\n      <p>{this.props.name} could not load. Other sections remain available.</p>\n      <button className=\"secondary-button\" onClick={() => this.setState({ failed: false })}>\n        Retry {this.props.name.toLowerCase()}\n      </button>\n    </section>;\n  }\n}\n");
