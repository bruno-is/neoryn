# Google Drive no Neoryn

## Configuração do Google Cloud

1. Crie um projeto, por exemplo **Neoryn**, em https://console.cloud.google.com/ . Não é necessário contratar servidor para esta implementação.
2. Em **APIs e serviços → Biblioteca**, habilite **Google Drive API** e **Google Picker API** no mesmo projeto.
3. Em **Google Auth Platform**, configure nome do aplicativo, e-mail de suporte, contato e público **Externo**. Durante a validação, mantenha em **Testing** e adicione sua conta em **Test users**.
4. Em **Data access**, declare apenas `https://www.googleapis.com/auth/drive.file`. Este escopo limita o acesso aos arquivos criados pelo aplicativo ou selecionados pelo usuário. Não use o escopo amplo `drive` para esta implementação.
5. Em **Clients**, crie um cliente OAuth do tipo **Web application**. Cadastre em **Authorized JavaScript origins**:
   - `https://bruno-is.github.io`
   - Para desenvolvimento: `http://127.0.0.1:4174`
   Não inclua `/neoryn/` na origem. O fluxo usa popup de tokens, sem endpoint de redirecionamento no servidor.
6. Copie o **Client ID**. Não coloque client secret no código, nas variáveis Vite ou no navegador.
7. Em **APIs e serviços → Credenciais**, crie uma chave API. Restrinja seu uso à **Google Picker API** e a referências HTTP permitidas:
   - `https://bruno-is.github.io/*`
   - `https://docs.google.com/*` (iframe do Picker, conforme documentação do Google)
   - `http://127.0.0.1:4174/*` apenas se precisar testar localmente.
8. Copie o **número do projeto**, disponível no painel do projeto. É o número, não o nome nem o ID textual.
9. No GitHub, abra **Settings → Secrets and variables → Actions → Variables** e adicione:

| Variável | Conteúdo |
| --- | --- |
| `VITE_GOOGLE_CLIENT_ID` | Client ID OAuth, terminado em `.apps.googleusercontent.com` |
| `VITE_GOOGLE_API_KEY` | Chave restrita à Picker API |
| `VITE_GOOGLE_APP_ID` | Número do projeto Google Cloud |

Esses identificadores são usados no navegador e ficam visíveis no JavaScript publicado. As restrições da chave e as origens OAuth são obrigatórias. Não são credenciais de servidor.

10. Execute novamente o workflow **Publicar Neoryn no GitHub Pages**. As variáveis entram no build; alterar variáveis sem novo build não ativa a integração.
11. Para abrir a integração a outros usuários, conclua os campos de marca, homepage, política de privacidade e termos aplicáveis no Google Auth Platform e publique o consentimento. A política de privacidade do site está em `https://bruno-is.github.io/neoryn/privacy.html`. Siga a verificação de marca solicitada pelo Google; publicar o site no GitHub não publica o consentimento OAuth.

## Custo

O uso padrão da Drive API não tem custo adicional. A documentação consultada em 01/11/2026 informa mudanças de cotas e cobrança futura acima de limites padrão; aumentos de cota podem exigir faturamento. Esta implementação não habilita faturamento, não cria recursos de computação e não solicita aumento de cotas. O conteúdo usa o armazenamento da conta de Drive de cada usuário.

Fontes: [limites da Drive API](https://developers.google.com/workspace/drive/api/guides/limits), [modelo de cotas](https://developers.google.com/workspace/tools-safety), [configuração do Picker](https://developers.google.com/workspace/drive/picker/guides/web-picker).

## Funcionamento e limites

- O salvamento local continua ativo. Autosave no Drive, envio de documentos locais, descoberta de arquivos autorizados e busca de atualizações têm controles independentes, armazenados por conta neste navegador.
- O envio automático inclui documentos criados após ativar a opção, exceto os marcados **Manter local**. Documentos anteriores devem ser selecionados para envio manual. Ative-o somente depois de escolher a pasta de destino.
- Arquivos já vinculados são atualizados onde estão no Drive; a pasta de destino vale para novos envios. A hierarquia local não move pastas remotas.
- A descoberta consulta apenas os arquivos autorizados diretamente na pasta selecionada, sem recursão. Escolher uma pasta não autoriza implicitamente todo seu conteúdo. Arquivos externos devem ser autorizados pelo seletor.
- Arquivos `.md`, `.markdown` e `.txt` são aceitos. Documentos Google nativos não são convertidos nesta integração.
- A sincronização automática verifica alterações a cada minuto enquanto a página estiver visível e ao retornar à aba ou à conexão. Edições locais são enviadas após 2,5 segundos de pausa, quando habilitado.
- Importar um backup como nova coleção cria cópias locais independentes, evitando dois documentos sincronizando com o mesmo arquivo. A recuperação da cópia anterior da biblioteca preserva os vínculos originais.
- Tokens existem somente em memória e expiram. Recarregar a página ou expirar a autorização exige reconexão. A biblioteca e seus vínculos persistem; tokens nunca são incluídos nos backups.
- O identificador estável da conta isola os vínculos. Trocar de conta não envia arquivos vinculados a outra conta.
- Cada upload novo recebe um ID do Drive persistido antes do envio. Repetir um envio interrompido reutiliza esse ID.
- A sincronização compara hashes de nome/conteúdo com a última versão comum. Alterações nos dois lados exigem resolução explícita. A versão substituída é preservada como documento local independente.
- O adaptador usa Drive API v2 para obter `etag` e realizar escritas condicionais com `If-Match`. Falhas de versão interrompem a operação. A leitura verifica a versão antes e depois do download.
- Exclusões locais não excluem arquivos no Drive. **Lixeira do Drive** exige confirmação e mantém a cópia local desvinculada. Arquivos removidos ou sem acesso no Drive geram aviso, preservando o conteúdo local.
- **Desconectar** encerra a sessão em memória. Para revogar a autorização do aplicativo na conta Google, use as conexões de terceiros nas configurações da conta.
- Sem backend, não há tarefas com o aplicativo fechado, webhooks nem renovação silenciosa permanente de acesso.

## Verificação

`npm test` verifica decisões de sincronização, versões condicionais, expiração, limites e paginação. `tests/drive.spec.ts` simula as APIs do Google com Playwright, sem acessar contas reais. Os identificadores fictícios usados pelo servidor de teste não são incluídos no build de produção.

Antes de considerar a ativação concluída, teste com um projeto Google real: autorização, seleção de pasta, importação, edição e envio, reconexão, outra conta/dispositivo, conflito, modo offline e lixeira em arquivos descartáveis. Os testes simulados não comprovam a configuração OAuth nem a compatibilidade da conta real.

Para desenvolvimento, copie `.env.example` para `.env.local`, preencha os três identificadores e execute `npm run dev -- --port 4174`. Nunca versionar `.env.local`.
