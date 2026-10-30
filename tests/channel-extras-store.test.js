import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {ChannelExtras} from '../channel-extras.js';
test('falha de gravação reverte categorias e apelidos em memória',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'teletela-extras-falha-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const blocked=path.join(dir,'arquivo');fs.writeFileSync(blocked,'x');const store=new ChannelExtras(blocked);
 assert.throws(()=>store.categorySave({type:'voice',name:'RPG'}));assert.equal(store.categories().length,2);
 assert.throws(()=>store.setNickname('identidade','text','aventura','Mago'));assert.equal(store.nickname('identidade','text','aventura'),'');
});
test('apagamento limpa apelidos e destino ausente; formatos inválidos não viram nome ou categoria',()=>{
 const store=new ChannelExtras();assert.throws(()=>store.categorySave({type:'voice',name:'\nInválido'}));assert.throws(()=>store.setNickname('id','text','x','x'.repeat(26)));
 store.setNickname('id','call','sala','Guerreiro');store.setNickname('id','text','sala','Mago');store.data.afk.channelId='sala';store.removeChannel('voice','sala');assert.equal(store.nickname('id','call','sala'),'');assert.equal(store.nickname('id','text','sala'),'Mago');assert.equal(store.data.afk.channelId,'');
});
