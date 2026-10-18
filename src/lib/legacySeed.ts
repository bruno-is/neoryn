import { DEFAULT_SETTINGS, type LibraryState } from './library'

// Frozen original samples: used only to recognize untouched content during migration.

const welcome = `# Um espaço para suas ideias

Toda grande ideia começa com um pequeno rascunho.
Este é o seu lugar para escrever, organizar pensamentos e dar forma ao que importa.

> Menos distrações. Mais espaço para o que você tem a dizer.

## 01 · Comece com uma ideia

Abra uma página em branco ou traga um arquivo **.md** que já faz parte da sua história. Seus documentos ficam salvos neste navegador, automaticamente, enquanto você escreve.

- Escreva com **clareza** e *liberdade*.
- Organize seus documentos em pastas.
- Marque seus textos favoritos para encontrá-los rapidamente.
- Ative o **modo leitura** pelo ícone de olho e aproveite o texto.

## 02 · Encontre seu ritmo

O Markdown transforma pequenos símbolos em grandes possibilidades. Digite \`#\` para um título, \`-\` para uma lista e \`**palavra**\` para dar ênfase.

### Uma lista para começar

- [x] Encontrar um espaço para escrever
- [ ] Registrar uma ideia que merece existir
- [ ] Criar uma pasta para o próximo projeto

## 03 · Suas palavras, com você

Feche esta aba e volte quando quiser: sua biblioteca estará aqui. Para levar seus textos a outro dispositivo, exporte um documento em Markdown ou faça um **backup da biblioteca** pelo menu de configurações.

Seus arquivos são privados e ficam neste navegador. Limpar os dados do site ou usar uma janela anônima pode apagar a biblioteca; mantenha um backup das ideias importantes.

---

*O próximo parágrafo é seu.*
`

const guide = `# Uma biblioteca com a sua cara

## Traga seus arquivos

Use **Importar** para abrir arquivos Markdown do computador. Você também pode arrastar arquivos .md sobre a janela. Cada arquivo vira um documento editável na sua biblioteca.

## Organize por assunto

Crie pastas para projetos, estudos e ideias pessoais. Dê nomes que façam sentido para você e marque como favoritos os documentos que usa com frequência.

## Escolha como escrever

- **Editor:** escreva com formatação visual.
- **Markdown:** veja e edite a sintaxe original.
- **Dividido:** acompanhe o texto e a prévia lado a lado.
- **Modo foco:** reduza as distrações ao redor do texto.
- **Modo leitura:** abra o ícone de olho para ler sem editar.

## Salve e leve com você

As alterações são salvas automaticamente no armazenamento local deste navegador. Não é preciso criar uma conta. A biblioteca permanece após fechar a página ou reiniciar o navegador.

O armazenamento pertence a este site, navegador e dispositivo. Ele não sincroniza com outros aparelhos. Limpar os dados do site ou navegar em uma janela anônima pode remover os documentos.

Exporte os arquivos .md individualmente ou baixe um backup da biblioteca nas configurações. O backup inclui documentos, pastas e preferências e pode ser importado novamente.

## Pequenos atalhos

Use os atalhos indicados nos botões e menus para encontrar documentos, salvar uma cópia ou alternar o modo de escrita. A busca encontra tanto nomes quanto conteúdo.
`

const examples = `# Um guia rápido de Markdown

## Texto com personalidade

Você pode escrever em **negrito**, em *itálico* ou ~~riscar uma ideia~~. Para código no meio do texto, use \`const ideia = 'começar'\`.

Crie um [link para o guia Markdown](https://www.markdownguide.org/basic-syntax/) ou inclua uma imagem com \`![descrição](endereço)\`.

## Listas que organizam

1. Capture a ideia.
2. Encontre a estrutura.
3. Escreva a primeira versão.

- [x] Preparar o ambiente
- [ ] Escrever sem pressa
- [ ] Revisar com atenção

## Citações

> Uma página em branco é um convite.
>
> Comece por qualquer lugar.

## Tabelas

| Etapa | O que fazer | Estado |
| :--- | :--- | :--- |
| Ideia | Anotar o essencial | Concluído |
| Rascunho | Encontrar as palavras | Em andamento |
| Revisão | Dar espaço ao texto | Próximo passo |

## Código

\`\`\`javascript
function começar(ideia) {
  return { ...ideia, primeiroPasso: 'escrever' }
}
\`\`\`

## Matemática

Uma fórmula no texto: $E = mc^2$.

$$
\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}
$$

## Uma pausa

Use três traços para criar uma separação:

---

E continue escrevendo.
`

export function createLegacySeedLibrary(now = Date.now()): LibraryState {
  return {
    documents: [
      { id: 'welcome', name: 'Um espaço para suas ideias', content: welcome, folderId: null, favorite: true, createdAt: now, updatedAt: now, deletedAt: null },
      { id: 'workspace-guide', name: 'Sua biblioteca, do seu jeito', content: guide, folderId: 'pessoal', favorite: false, createdAt: now, updatedAt: now, deletedAt: null },
      { id: 'markdown-guide', name: 'Guia de Markdown', content: examples, folderId: 'referencias', favorite: false, createdAt: now, updatedAt: now, deletedAt: null },
    ],
    folders: [
      { id: 'pessoal', name: 'Pessoal', parentId: null, createdAt: now },
      { id: 'projetos', name: 'Projetos', parentId: null, createdAt: now },
      { id: 'referencias', name: 'Referências', parentId: null, createdAt: now },
    ],
    activeId: 'welcome',
    openTabIds: ['welcome'],
    settings: { ...DEFAULT_SETTINGS },
  }
}
