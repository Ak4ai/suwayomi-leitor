"""Register only the two project samples in the local server library."""
import json
from pathlib import Path

import httpx

server = 'http://127.0.0.1:4567'
titles = {'Amostra IHC - OCR ingles', 'Ultimate Spider-Man - amostra salva'}

def gql(client, query, variables=None):
    response = client.post(server + '/api/graphql', json={'query': query, 'variables': variables or {}})
    response.raise_for_status()
    body = response.json()
    if body.get('errors'):
        raise RuntimeError(body['errors'])
    return body['data']

registered = []
with httpx.Client(timeout=60) as client:
    data = gql(client, 'mutation($input:FetchSourceMangaInput!){fetchSourceManga(input:$input){mangas{id title}}}', {'input': {'source': '0', 'type': 'POPULAR', 'page': 1}})
    for manga in data['fetchSourceManga']['mangas']:
        if manga['title'] not in titles:
            continue
        gql(client, 'mutation($id:Int!){updateManga(input:{id:$id,patch:{inLibrary:true}}){manga{id inLibrary}}}', {'id': manga['id']})
        chapter_data = gql(client, 'mutation($id:Int!){fetchMangaAndChapters(input:{id:$id,fetchManga:true,fetchChapters:true}){chapters{id name}}}', {'id': manga['id']})
        for chapter in chapter_data['fetchMangaAndChapters']['chapters']:
            pages = gql(client, 'mutation($id:Int!){fetchChapterPages(input:{chapterId:$id}){pages}}', {'id': chapter['id']})['fetchChapterPages']['pages']
            entry = {'title': manga['title'], 'mangaId': manga['id'], 'chapterId': chapter['id'], 'pages': len(pages), 'readerUrl': f'{server}/manga/{manga["id"]}/chapter/{chapter["id"]}'}
            registered.append(entry)
            print(json.dumps(entry), flush=True)

destination = Path(__file__).resolve().parent.parent / '.local-server/samples.json'
destination.write_text(json.dumps(registered, indent=2), encoding='utf-8')
