export function serverBase(value){const url=new URL(value);if(!['http:','https:'].includes(url.protocol))throw new Error('Use um endereço HTTP ou HTTPS do Suwayomi.');url.pathname=url.pathname.replace(/\/(?:library|manga.*|reader.*)\/?$/,'').replace(/\/$/,'');url.search='';url.hash='';return url.href.replace(/\/$/,'');}
export async function suwayomiQuery(server,query,variables={},signal){
    const response=await fetch(`${serverBase(server)}/api/graphql`,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({query,variables}),signal});
    if(!response.ok)throw new Error(`Suwayomi HTTP ${response.status}.`);
    const body=await response.json();
    if(body.errors?.length){
        if(body.errors.some(e=>/Collection is empty|chapter.*not found/i.test(e.message)))throw new Error('O capítulo não está disponível neste servidor. Confira o link ou recarregue a biblioteca no Suwayomi.');
        throw new Error(body.errors.map(e=>String(e.message).split('\n')[0].slice(0,250)).join('; '));
    }
    return body.data;
}
async function collection(server,name,condition,fields,signal){
    const nodes=[];let offset=0;
    do{const data=await suwayomiQuery(server,`query($offset:Int){${name}(condition:${condition},first:100,offset:$offset){nodes{${fields}} totalCount}}`,{offset},signal),page=data[name];nodes.push(...page.nodes);if(!page.nodes.length||nodes.length>=page.totalCount)break;offset+=page.nodes.length;}while(true);
    return nodes;
}
export const library=(server,signal)=>collection(server,'mangas','{inLibrary:true}','id title',signal);
export const chapters=(server,id,signal)=>{if(!Number.isSafeInteger(Number(id))||Number(id)<0)throw new Error('Obra inválida.');return collection(server,'chapters',`{mangaId:${Number(id)}}`,'id name chapterNumber sourceOrder',signal);};
export async function chapterPages(server,id,signal){
    const data=await suwayomiQuery(server,'mutation($input:FetchChapterPagesInput!){fetchChapterPages(input:$input){pages}}',{input:{chapterId:Number(id)}},signal);
    return data.fetchChapterPages.pages.map((url,index)=>({id:`${id}:${index}`,name:`Página ${index+1}`,url:new URL(url,`${serverBase(server)}/`).href}));
}
