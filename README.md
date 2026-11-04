# PowerDesigner Model Visualizer

Interface web local para abrir modelos SAP PowerDesigner (`.pdm` e `.cdm`), selecionar os objetos que devem aparecer no diagrama e consultar seus metadados. Modelos CDM são exibidos com entidades, atributos, identificadores e relacionamentos na representação conceitual ER/Merise.

O projeto combina duas ideias MIT:

- a leitura estrutural de tabelas, colunas, chaves e tipos do [bianjp/pdmreader](https://github.com/bianjp/pdmreader);
- a navegação visual, expansão e exploração do [iladan0/XML-Tree-Visualizer](https://github.com/iladan0/XML-Tree-Visualizer).

As adaptações incluem leitura tolerante de PDMs grandes, referências físicas, outros tipos de objeto, painel temático com seleção independente e inspector de metadados. A interface não usa CDN e funciona sem acesso à internet.

## Executar com Docker

Na pasta deste projeto:

```bash
docker compose up --build -d
```

Acesse [http://localhost:8080](http://localhost:8080) e clique em **Abrir modelo**. O botão **Ver exemplo** carrega um modelo demonstrativo para conhecer a interface sem fornecer um arquivo.

Para encerrar:

```bash
docker compose down
```

## Como usar

1. Abra um `.pdm`, `.cdm` ou `.xml` exportado pelo PowerDesigner.
2. Na árvore à esquerda, expanda um tema e marque os objetos desejados.
3. Para exibir linhas entre tabelas, marque os relacionamentos correspondentes ou use o botão **↔** para habilitar todos os relacionamentos existentes entre as tabelas selecionadas.
4. Arraste o fundo para navegar, use a roda para zoom e arraste os cartões para reorganizá-los.
5. Clique em uma tabela para abrir os metadados à direita.
6. No painel direito, marque as colunas cujos metadados completos deseja consultar.

## Segurança e limites

- O XML é processado sem entidades externas e sem acesso de rede.
- O tamanho máximo aceito é 150 MB.
- O contêiner roda com usuário sem privilégios e sistema de arquivos somente leitura no Compose.
- O arquivo enviado é mantido apenas na memória durante a requisição; não é persistido.

## Desenvolvimento e testes

Requer Python 3.11 ou mais recente.

```bash
python -m venv .venv
. .venv/bin/activate
pip install -e '.[test]'
pytest
uvicorn app.main:app --reload --port 8080
```

Documentação da API: [http://localhost:8080/api/docs](http://localhost:8080/api/docs).

## Estrutura

```text
app/
  main.py              API e entrega dos arquivos estáticos
  pdm_parser.py        parser e normalização do PowerDesigner
  static/              interface web sem dependências externas
tests/                 testes unitários e de integração HTTP
third_party/           licenças dos projetos de origem
Dockerfile             imagem de produção
docker-compose.yml     execução local endurecida
```

## Licenças

Este projeto é distribuído sob MIT. Consulte `THIRD_PARTY_NOTICES.md` e as licenças preservadas em `third_party/`.
