const storageKey='ihc-chapter-preferences-v1';
export function loadPreferences(){
    try{
        const value=JSON.parse(localStorage.getItem(storageKey)||'{}'),oldServer='https://suwayomi-server-ak4ai.fly.dev';let migrated=false;
        if(typeof value.server==='string'&&value.server.startsWith(oldServer)){value.server='http://127.0.0.1:4567';migrated=true;}
        if(typeof value['chapter-link']==='string'&&value['chapter-link'].startsWith(oldServer)){value['chapter-link']='http://127.0.0.1:4567/manga/1/chapter/1';migrated=true;}
        if(migrated)savePreferences(value);
        return value;
    }catch{return {};}
}
export function savePreferences(settings){
    const value={...settings};if(!value.rememberKey)delete value.key;
    try{localStorage.setItem(storageKey,JSON.stringify(value));return true;}catch{return false;}
}
