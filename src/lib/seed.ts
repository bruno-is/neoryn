import { DEFAULT_SETTINGS, type LibraryState } from './library'

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

Use **Pasta inteira** para importar uma pasta com seus arquivos e subpastas. A estrutura é mantida na biblioteca.

No menu **⋯** ao lado da estrela, escolha **Copiar Markdown** para copiar o documento completo. Clique no logo **neoryn** para voltar ao início.

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

export function createSeedLibrary(now = Date.now()): LibraryState {
  return {
    starterContentVersion: 2,
    documents: [
      { id: 'welcome', name: 'Um espaço para suas ideias', content: welcome, folderId: null, favorite: true, createdAt: now, updatedAt: now, deletedAt: null },
    ],
    folders: [],
    activeId: 'welcome',
    openTabIds: ['welcome'],
    settings: { ...DEFAULT_SETTINGS },
  }
}
