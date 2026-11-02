# Editor de recomendações

Projeto Node.js independente para cadastrar as aplicações testadas no DockProxy.

## Executar

Na pasta `recomendacoes`:

```sh
npm start
```

Abra `http://IP-DO-SERVIDOR:3100` em qualquer dispositivo da rede. O editor escuta em `0.0.0.0` por padrão.

O editor grava o arquivo:

```text
recomendacoes/recomendacoes.json
```

Esse é o arquivo que a aba **Recomendações** do painel principal consulta.

## Campos

- **Aplicação**: nome exibido no cartão;
- **Descrição**: resumo curto;
- **Porta local**: porta do serviço;
- **Rota pública**: caminho usado no proxy, como `/upsnap`;
- **Tipo de proxy**: com ou sem reescrita;
- **Status**: testado ou a testar;

O editor escuta em todas as interfaces de rede na porta 3100. Isso permite acesso pela rede local, mas também significa que qualquer dispositivo com acesso a essa rede poderá abrir o editor. Não encaminhe essa porta para a internet sem adicionar autenticação e firewall.

## Publicar no GitHub

A aba **Deploy no GitHub** envia todos os arquivos do projeto para a branch escolhida usando o GitHub CLI (`gh`) já autenticado na máquina. O usuário é obtido da conta ativa do `gh` e o nome do repositório é o nome da pasta principal do projeto. O andamento aparece em um terminal dentro da página. Se a sessão expirar, execute `gh auth login` no terminal e tente novamente.
