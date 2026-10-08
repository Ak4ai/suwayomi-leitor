import type {IncomingMessage,ServerResponse} from 'node:http';
export function handleTranslationRelay(request:IncomingMessage,response:ServerResponse):Promise<boolean>;
