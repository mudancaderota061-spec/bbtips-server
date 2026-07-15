# BBTips Server

Servidor de login, painel admin e painel proprio de futebol virtual.

## Painel Virtual Pro

Abra `/virtual` no dominio do servidor.

O painel novo e somente para futebol virtual e usa os dados do servidor, nao a leitura visual da extensao. Ele mostra:

- resumo das 5 ligas da Bet365;
- grafico de tendencia por liga e mercado;
- buscador de padrao automatico;
- buscador de padrao manual;
- alerta de minima;
- alerta de placares;
- proximos jogos com combo score.

## Variaveis no Railway

- `DATABASE_URL`: criada pelo Postgres do Railway.
- `JWT_SECRET`: chave grande aleatoria.
- `ADMIN_USER`: login do administrador.
- `ADMIN_PASS`: senha do administrador.

## Deploy no Render

O arquivo `render.yaml` ja deixa pronto um Web Service Node e um Postgres.

No Render, use Blueprint ou New Web Service apontando para este repositorio. Configure `ADMIN_PASS` nas variaveis do servico antes do primeiro acesso.

## Rodar

```bash
npm install
npm start
```
