# NEORYN — Graphite Blue e continuidade dos dados

**Um espaço para suas ideias.** Escreva, organize e desenvolva suas ideias em um ambiente pessoal, sem distrações.

## Identidade Graphite Blue

**90% neutralidade, 10% identidade.** Fundos grafite fosco, superfícies discretas e azul reservado à marca, ações, links e estados ativos. Sem brilhos, sombras coloridas ou grandes áreas em gradiente. O layout, as proporções do logo e a tipografia de leitura permanecem os mesmos.

O símbolo é um N geométrico formado por segmentos conectados, com duas dobras discretas. O gradiente azul `#3B82F6` → azul claro `#93C5FD` fica concentrado na marca. O wordmark `neoryn` usa desenho sans-serif geométrico próprio, convertido em traçados SVG: não depende de fontes, serviços ou downloads externos.

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

## Paleta e tokens semânticos

Os tokens ficam em `src/styles.css`. Milkdown, CodeMirror e leitura compartilham esses valores; `src/components/codeTheme.ts` associa as categorias sintáticas aos tokens, sem cores próprias. Evite hexadecimais em componentes. O HTML exportado incorpora os tokens do tema ativo para manter a identidade sem depender de CSS externo.

| Token | Claro | Escuro | Uso |
| --- | --- | --- | --- |
| `--bg` | `#F7F8FA` | `#181A1F` | Fundo principal |
| `--sidebar` | `#F0F2F5` | `#121418` | Navegação |
| `--paper` | `#FFFFFF` | `#181A1F` | Escrita e leitura |
| `--surface`, `--surface-raised` | `#FFFFFF` | `#252A31` | Superfícies elevadas |
| `--subtle` | `#F1F3F6` | `#202329` | Superfícies secundárias |
| `--hover` | `#E6ECF3` | `#2A2E36` | Interação |
| `--selection`, `--accent-soft` | `#E7F0FF` | `#203651` | Seleção |
| `--border` | `#D9E0E9` | `#333840` | Divisores decorativos |
| `--control-border` | `#7B8796` | `#737F91` | Campos, checkboxes e diagramas |
| `--text` | `#1E2430` | `#ECEFF4` | Texto principal |
| `--muted` | `#586475` | `#A1AAB8` | Texto secundário e ícones |
| `--accent`, `--focus` | `#1D5EC9` | `#77B6FF` | Links, seleção ativa e foco |
| `--accent-strong` | `#1D4ED8` | `#91C5FF` | Botões primários |
| `--on-accent` | `#FFFFFF` | `#181A1F` | Texto sobre botões |
| `--brand-primary` | `#3B82F6` | `#3B82F6` | Início do gradiente do logo |
| `--brand-secondary` | `#93C5FD` | `#93C5FD` | Final do gradiente do logo |

O light mode mantém superfícies editoriais claras. O dark mode usa grafite neutro; azul aparece apenas em áreas pequenas com função clara. Favicon, maskable e Apple touch usam fundo `#181A1F`; ícones comuns preservam transparência. A geometria de todos os seis SVGs foi comparada com a versão anterior e permanece idêntica.

Código usa superfícies neutras (`--code-bg` e `--code-inline-bg`), palavras-chave azuis, strings verde-azuladas, números ocres e comentários neutros. Sucesso, aviso, erro e favoritos preservam suas cores semânticas. Mermaid recebe os tokens `--diagram-*`, `--text` e `--control-border`, sem gradientes ou sombras automáticas da biblioteca.

Divisores discretos não substituem bordas funcionais: campos de formulário usam `--control-border`. Botões usam `--on-accent`, inclusive no modo leitura. O foco por teclado tem contorno visível e os movimentos respeitam `prefers-reduced-motion`. A preferência automática acompanha tanto a interface quanto o ícone de tema e o metadado `theme-color`.

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

A atualização Graphite Blue mantém os mesmos `id`, `scope`, `start_url` e URLs de assets. O Workbox atribui revisões por conteúdo aos SVGs, PNGs e demais recursos: uma nova versão instala seu precache sem apagar IndexedDB ou rascunhos. Com uma versão antiga aberta, o worker novo aguarda: feche todas as abas/janelas da aplicação e abra novamente online para ativá-lo. Não há recarregamento forçado durante a escrita. A atualização do ícone no sistema operacional depende também do navegador.

O worker e o aplicativo instalado do caminho anterior não mudam de endereço automaticamente. Abra a nova URL online para preparar seu cache e instale a nova PWA, caso use a versão instalada. O Neoryn não apaga caches ou registros de outros caminhos. Feche a aba antiga antes de editar na nova; enquanto ela detiver o bloqueio, a nova aba abre para leitura/exportação. **Não limpe os dados do site para trocar de versão.** Mantenha um backup antes de qualquer mudança de domínio ou remoção de uma instalação.

O GitHub não garante redirecionamento de URLs de sites Pages ao renomear repositórios; links e atalhos antigos precisam ser atualizados. Referências: [renomeação de repositórios](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository) e [armazenamento e escopo de PWAs entre origens](https://web.dev/articles/multi-origin-pwas).

## Validação

`npm test` valida os dados, backups, snapshots, recuperação de rascunhos e a atualização conservadora da introdução. `npm run test:e2e` cobre edição, leitura, importação/exportação, navegação, organização, persistência após reiniciar e uso no celular. `tests/brand.spec.ts` verifica identidade, temas, ausência de erros de console, a paleta oficial, contraste mínimo de 4,5:1 para textos, botões, seleção, superfícies e sintaxe, além de 3:1 para foco, bordas funcionais e diagramas e continuidade entre caminhos. Os testes também verificam as cores renderizadas do editor, tabelas, checkboxes, código, Mermaid, campos e HTML exportado. A verificação de contraste é direcionada aos tokens; não equivale a uma auditoria integral de acessibilidade.

Com `NEORYN_PRODUCTION_TEST=1` e a prévia ativa, `tests/offline.spec.ts` verifica o escopo do worker, manifesto, dimensões, transparência e cor dos PNGs, além do gradiente azul dos SVGs em cache e recarregamento/edição/leitura offline sob `/neoryn/`. O workflow executa todos esses testes antes do deploy. As imagens `docs/preview*.png` são capturas reais da aplicação.
