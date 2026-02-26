# monitor-turnos

Script em Node.js para monitorar a disponibilidade de turnos no site:

- `https://titulosvalidez.educacion.gob.ar/validez/detitulos/`

## Como funciona

- Faz uma requisição HTTP GET de forma flexível por horário:
  - das 00:00 às 06:59: a cada 1 minuto;
  - das 07:00 às 23:59: a cada 10 minutos.
- Verifica a URL final após redirecionamentos.
- Se a URL final for igual à URL bloqueada conhecida, não envia nada.
- Se a URL final for diferente, envia alerta por e-mail e Telegram imediatamente.
- Em erro de rede/execução, aguarda 60 segundos antes de tentar novamente.

## Requisitos

- Node.js `20.6+`
- pnpm
- Conta Gmail com **App Password** ativa
- Bot do Telegram com token e chat ID

## Instalação

```bash
pnpm install
```

## Configuração

1. Copie o arquivo de exemplo:

```bash
cp .env.example .env
```

2. Preencha as variáveis em `.env`:

- `EMAIL_USER`
- `EMAIL_PASS`
- `EMAIL_TO`
- `TELEGRAM_TOKEN`
- `TELEGRAM_CHAT_ID`

> O script valida as variáveis no startup e encerra com erro se faltar alguma.

## Execução

```bash
node --env-file=.env monitor.js
```

ou

```bash
pnpm start
```

## Como validar se está funcionando corretamente

### 1) Validar sintaxe do script

```bash
pnpm check
```

### 2) Rodar apenas uma checagem (sem loop infinito)

```bash
pnpm check:once
```

Isso valida se a requisição para o site alvo está funcionando e mostra no log a URL final detectada.

### 3) Testar notificações (e-mail + Telegram)

```bash
pnpm self-test
```

Esse comando:

- faz uma checagem real do site;
- envia notificações de teste para os canais configurados (e-mail e Telegram);
- encerra o processo ao final.

> Dica: rode o `self-test` sempre que mudar variáveis do `.env` para confirmar credenciais e integrações.

## URL bloqueada conhecida

```text
https://titulosvalidez.educacion.gob.ar/validez/detitulos/noaccess.php?sinT=1&msj=Lamentablemente+no+hay+turnos+disponibles+debido+al+alto+nivel+de+demanda.%0APor+favor%2C+vuelva+a+intentar+en+otro+momento.
```

## Observações

- Não há proteção anti-spam por design: se a URL final continuar diferente da bloqueada, o alerta será enviado em toda checagem.
