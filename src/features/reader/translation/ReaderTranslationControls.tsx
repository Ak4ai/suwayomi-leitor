import { useState } from 'react';
import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useNativeTranslation } from './NativeTranslation.ts';
export function ReaderTranslationControls() {
    const { state, module, error } = useNativeTranslation();
    const [editing, setEditing] = useState(false),
        [provider, setProvider] = useState('google'),
        [opusVariant, setOpusVariant] = useState<'compact' | 'big'>('compact'),
        [opusNormalize, setOpusNormalize] = useState(true),
        [key, setKey] = useState(''),
        [model, setModel] = useState(''),
        [mode, setMode] = useState('wasm'),
        [renderer, setRenderer] = useState<'canvas' | 'svg'>('canvas'),
        [inpaint, setInpaint] = useState<'local' | 'hybrid' | 'ai'>('local'),
        [inpaintDevice, setInpaintDevice] = useState<'auto' | 'wasm'>('auto'),
        [remember, setRemember] = useState(true),
        [models, setModels] = useState<{ id: string; label: string }[]>([]),
        [message, setMessage] = useState('');
    return (
        <Box sx={{ p: 2 }} onClick={(e) => e.stopPropagation()}>
            <Typography variant="subtitle2">Tradução · inglês → português</Typography>
            <FormControlLabel
                sx={{ display: 'flex' }}
                control={
                    <Switch
                        checked={state.enabled}
                        disabled={!module}
                        onChange={(_, value) => module?.toggle('enabled', value)}
                    />
                }
                label="Traduzir automaticamente"
            />
            <FormControlLabel
                sx={{ display: 'flex' }}
                control={
                    <Switch
                        checked={state.showInfo}
                        disabled={!module}
                        onChange={(_, value) => module?.toggle('showInfo', value)}
                    />
                }
                label="Mostrar informações da tradução"
            />
            {error && <Typography color="error">{error}</Typography>}
            <Button
                size="small"
                onClick={() => {
                    const p = module?.getPreferences();
                    setProvider(p?.provider || 'google');
                    setOpusVariant(p?.opusVariant || 'compact');
                    setOpusNormalize(p?.opusNormalize !== false);
                    setKey(p?.key || '');
                    setModel(p?.model || '');
                    setMode(p?.mode || 'wasm');
                    setRenderer(p?.renderer || 'canvas');
                    setInpaint(p?.inpaint || 'local');
                    setInpaintDevice(p?.inpaintDevice || 'auto');
                    setRemember(p?.rememberKey !== false);
                    setEditing(!editing);
                }}
            >
                Configurar tradução
            </Button>
            {editing && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}>
                    <TextField
                        select
                        label="Tradutor"
                        helperText={
                            provider === 'opus'
                                ? 'Tradução no aparelho, sem chave. Experimental: confira o sentido das falas.'
                                : provider === 'gemini'
                                  ? undefined
                                  : 'No modo local, o texto passa pelo servidor do leitor antes de chegar ao tradutor.'
                        }
                        size="small"
                        value={provider}
                        onChange={(e) => setProvider(e.target.value)}
                    >
                        <MenuItem value="google">Google sem chave (experimental)</MenuItem>
                        <MenuItem value="gemini">Gemini</MenuItem>
                        <MenuItem value="mymemory">MyMemory</MenuItem>
                        <MenuItem value="opus">OPUS-MT local (experimental)</MenuItem>
                    </TextField>
                    {provider === 'opus' && (
                        <>
                            <TextField
                                select
                                label="Modelo OPUS-MT"
                                size="small"
                                value={opusVariant}
                                onChange={(e) => setOpusVariant(e.target.value as 'compact' | 'big')}
                                helperText="O modelo fica em cache no navegador. O maior exige mais tempo e memória."
                            >
                                <MenuItem value="compact">Compacto: cerca de 122 MB</MenuItem>
                                <MenuItem value="big">Maior: cerca de 519 MB</MenuItem>
                            </TextField>
                            <FormControlLabel
                                control={<Switch checked={opusNormalize} onChange={(_, v) => setOpusNormalize(v)} />}
                                label="Normalizar maiúsculas para o OPUS"
                            />
                            <Typography variant="caption">
                                Pode melhorar falas em maiúsculas, mas alterar nomes próprios. O texto original do OCR
                                permanece no painel.
                            </Typography>
                        </>
                    )}
                    <TextField select label="OCR" size="small" value={mode} onChange={(e) => setMode(e.target.value)}>
                        <MenuItem value="wasm">WASM</MenuItem>
                        <MenuItem value="auto">WebGPU com fallback</MenuItem>
                    </TextField>
                    <TextField
                        select
                        label="Desenho do texto"
                        size="small"
                        value={renderer}
                        onChange={(e) => setRenderer(e.target.value as 'canvas' | 'svg')}
                    >
                        <MenuItem value="canvas">Canvas (imagem)</MenuItem>
                        <MenuItem value="svg">SVG (texto vetorial · experimental)</MenuItem>
                    </TextField>
                    <TextField
                        select
                        label="Limpeza do texto original"
                        size="small"
                        value={inpaint}
                        onChange={(e) => setInpaint(e.target.value as 'local' | 'hybrid' | 'ai')}
                        helperText={
                            inpaint !== 'local'
                                ? 'LaMa baixa cerca de 62 MB no primeiro uso. Processamento local; pode consumir mais memória e tempo.'
                                : 'Modo leve, sem modelo adicional.'
                        }
                    >
                        <MenuItem value="local">Leve (padrão)</MenuItem>
                        <MenuItem value="hybrid">Híbrido: leve + IA nos fundos difíceis</MenuItem>
                        <MenuItem value="ai">IA em todos os balões (comparação)</MenuItem>
                    </TextField>
                    {inpaint !== 'local' && (
                        <TextField
                            select
                            label="Processamento da limpeza"
                            size="small"
                            value={inpaintDevice}
                            onChange={(e) => setInpaintDevice(e.target.value as 'auto' | 'wasm')}
                        >
                            <MenuItem value="auto">Automático (WebGPU quando disponível)</MenuItem>
                            <MenuItem value="wasm">WASM</MenuItem>
                        </TextField>
                    )}
                    {provider === 'gemini' && (
                        <>
                            <TextField
                                type="password"
                                label="Chave Gemini"
                                size="small"
                                value={key}
                                onChange={(e) => {
                                    setKey(e.target.value);
                                    setModels([]);
                                    setModel('');
                                }}
                            />
                            <FormControlLabel
                                control={<Switch checked={remember} onChange={(_, v) => setRemember(v)} />}
                                label="Lembrar chave neste navegador"
                            />
                            <Typography variant="caption">
                                A chave lembrada fica salva no armazenamento local deste navegador.
                            </Typography>
                            <Button
                                onClick={async () => {
                                    try {
                                        const values = await module?.getModels(key);
                                        setModels(values || []);
                                        if (values?.length) setModel(values[0].id);
                                        setMessage('');
                                    } catch (e) {
                                        setMessage(String(e));
                                    }
                                }}
                            >
                                Carregar modelos
                            </Button>
                            <TextField
                                select
                                label="Modelo"
                                size="small"
                                value={model}
                                onChange={(e) => setModel(e.target.value)}
                            >
                                {!models.length && <MenuItem value={model}>{model || 'Carregue os modelos'}</MenuItem>}
                                {models.map((m) => (
                                    <MenuItem key={m.id} value={m.id}>
                                        {m.label}
                                    </MenuItem>
                                ))}
                            </TextField>
                        </>
                    )}
                    <Button
                        onClick={() => {
                            module?.setPreferences({
                                provider,
                                opusVariant,
                                opusNormalize,
                                key,
                                model,
                                mode,
                                renderer,
                                inpaint,
                                inpaintDevice,
                                rememberKey: remember,
                            });
                            setEditing(false);
                        }}
                    >
                        Salvar
                    </Button>
                    {message && (
                        <Typography color="error" variant="caption">
                            {message}
                        </Typography>
                    )}
                </Box>
            )}
        </Box>
    );
}
