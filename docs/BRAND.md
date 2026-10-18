# NEORYN — identidade e continuidade dos dados

**Um espaço para suas ideias.** Escreva, organize e desenvolva suas ideias em um ambiente pessoal, sem distrações.

## Identidade

O símbolo é um N geométrico formado por segmentos conectados, com duas dobras discretas. O gradiente violeta `#7C6CFF` → azul `#60A5FA` fica concentrado na marca. O wordmark `neoryn` usa desenho sans-serif geométrico próprio, convertido em traçados SVG: não depende de fontes, serviços ou downloads externos.

| Uso | Arquivo |
| --- | --- |
| Logo principal / fundo claro | `public/brand/logo-light.svg` |
| Logo / fundo escuro | `public/brand/logo-dark.svg` |
| Logo monocromático | `public/brand/logo-mono.svg` |
| Símbolo independente | `public/brand/symbol.svg` |
| Símbolo monocromático | `public/brand/symbol-mono.svg` |
| Favicon com fundo grafite | `public/favicon.svg` |
| PWA, fundo transparente | `public/icons/icon-192.png`, `icon-512.png` |
| PWA maskable, área segura central | `public/icons/maskable-512.png` |
| Apple touch, fundo opaco | `public/icons/apple-touch-icon.png` |

As variantes monocromáticas usam `currentColor`; ao incorporar o SVG inline é possível definir branco ou qualquer cor de impressão. Preserve a proporção, o espaço ao redor e a geometria. O gerador `scripts/generate-brand.mjs` centraliza símbolo, lettering e variantes; `npm run brand:generate` rasteriza os PNGs com Playwright, já disponível no projeto.

Os tokens de interface ficam em `src/styles.css`. No tema claro, links e ações usam violeta `#6250CE` sobre branco; no escuro, `#ADA2FF` sobre grafite `#0F172A`, com texto `#E5E7EB`. O violeta original é reservado à marca para não prejudicar a legibilidade de textos pequenos. A interface mantém fontes de sistema e a tipografia serifada de leitura. Animações respeitam `prefers-reduced-motion`, e controles mantêm indicação de foco por teclado.

## Compatibilidade com instalações anteriores

Nenhum banco, store, versão de esquema, ID de documento ou preferência foi renomeado. Não há migração destrutiva de armazenamento. Os seguintes nomes antigos são contratos de compatibilidade deliberados:

| Identificador preservado | Motivo |
| --- | --- |
| `lume-library` | Abrir o IndexedDB existente, versão 1, store `library` |
| `lume-pending-drafts-v1` | Recuperar alterações ainda não consolidadas, inclusive após falha |
| `lume-backup`, versão 1 | Ler backups e snapshots antigos e manter compatibilidade de exportação |
| `lume-library-writer` | Compartilhar o bloqueio de escrita com abas antigas na mesma origem |

Os arquivos baixados agora se chamam `neoryn-backup.json`, mas o campo técnico `format` continua igual. A importação mantém as validações e não substitui documentos existentes.

`src/lib/legacyWelcome.ts` congela a introdução antiga apenas para reconhecimento. A atualização exige ID, título, conteúdo exato, datas de criação/edição iguais e ausência de exclusão. Altera somente o texto da introdução original intocada; nomes, textos personalizados, favoritos, pastas e datas permanecem. A operação é idempotente, e o salvamento mantém o snapshot anterior recuperável. Testes também preservam menções à marca antiga como dados de usuário: esse conteúdo não deve ser substituído indiscriminadamente. A sequência semelhante em um hash de integridade do lockfile não é uma referência de marca e permanece intacta.

## GitHub Pages e PWA

O endereço solicitado `Burnninel/lume` redirecionava, na auditoria, para o repositório real `bruno-is/lume`. A renomeação usa o proprietário real; a URL de destino é `https://bruno-is.github.io/neoryn/`. Não há transferência de propriedade nem recriação do repositório.

A mudança de `/lume/` para `/neoryn/` em **https://bruno-is.github.io** mantém a origem. No mesmo navegador e perfil, o IndexedDB, os rascunhos e o bloqueio continuam compartilhados. Isso é coberto por um teste E2E com dados no caminho anterior e leitura/edição no novo. Já **https://burnninel.github.io** é outra origem: se a biblioteca estiver ali, exporte o backup a partir dessa origem e importe no endereço atual. Não existe migração automática entre domínios, perfis ou dispositivos.

O `base: './'` do Vite e os assets relativos permitem publicar sob o novo diretório. O manifesto usa `id`, `start_url` e `scope` relativos; o worker fica limitado ao diretório em que está instalado. O precache inclui os logos, favicon, PNGs, fontes e módulos para manter o editor e a identidade disponíveis offline.

O worker e o aplicativo instalado do caminho anterior não mudam de endereço automaticamente. Abra a nova URL online para preparar seu cache e instale a nova PWA, caso use a versão instalada. O Neoryn não apaga caches ou registros de outros caminhos. Feche a aba antiga antes de editar na nova; enquanto ela detiver o bloqueio, a nova aba abre para leitura/exportação. **Não limpe os dados do site para trocar de versão.** Mantenha um backup antes de qualquer mudança de domínio ou remoção de uma instalação.

O GitHub não garante redirecionamento de URLs de sites Pages ao renomear repositórios; links e atalhos antigos precisam ser atualizados. Referências: [renomeação de repositórios](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository) e [armazenamento e escopo de PWAs entre origens](https://web.dev/articles/multi-origin-pwas).

## Validação

`npm test` valida os dados, backups, snapshots, recuperação de rascunhos e a atualização conservadora da introdução. `npm run test:e2e` cobre edição, leitura, importação/exportação, navegação, organização, persistência após reiniciar e uso no celular. `tests/brand.spec.ts` verifica identidade, temas, ausência de erros de console, contraste mínimo de 4,5:1 dos principais pares de texto e continuidade entre caminhos. A verificação de contraste é direcionada aos tokens; não equivale a uma auditoria integral de acessibilidade.

Com `NEORYN_PRODUCTION_TEST=1` e a prévia ativa, `tests/offline.spec.ts` verifica o escopo do worker, manifesto, dimensões dos PNGs e recarregamento/edição/leitura offline sob `/neoryn/`. O workflow executa todos esses testes antes do deploy. As imagens `docs/preview*.png` são capturas reais da aplicação.
