# WalletQuantso

Sistema **particular** de gestão financeira pessoal, inspirado na organização e
facilidade de uso do Meu Dinheiro Web, porém com identidade e código próprios.
Permite controlar contas a pagar e a receber, conciliar movimentos, acompanhar
fluxo de caixa e visualizar tudo em dashboards e relatórios.

> ⚠️ **Aviso:** este sistema armazena **dados financeiros particulares**
> (contas, valores, lançamentos). Mantenha o repositório privado, não compartilhe
> credenciais e proteja o acesso à sua conta.

## Principais funcionalidades

- Contas a pagar e a receber (com vencimentos, pagamento/recebimento parcial).
- Lançamentos de receitas, despesas e transferências.
- Conciliação manual de lançamentos com movimentos.
- Organização por conta financeira, categoria/subcategoria e centro de custo.
- Dashboards com saldo, receitas, despesas, resultado e vencimentos.
- Relatórios e gráficos (por categoria, por mês, evolução de saldo).
- Importação de planilhas (CSV/XLS/XLSX) calibrada ao layout do Meu Dinheiro,
  com pré-visualização, deduplicação, auditoria e desfazer.
- Exportação em CSV e impressão/PDF.
- Autenticação por usuário e isolamento de dados via regras do Firestore.

## Tecnologias utilizadas

- **Next.js** (App Router) + **React** + **TypeScript**
- **Firebase**: Authentication, Cloud Firestore, Storage
- **SheetJS (xlsx)** e **PapaParse** para leitura de planilhas
- **Vitest** para testes unitários

## Instalação

```bash
npm install
```

## Execução local

```bash
cp .env.example .env.local   # preencha os valores do seu projeto Firebase
npm run dev                  # http://localhost:3000
npm test                     # testes unitários
npm run build                # build de produção
```

## Variáveis de ambiente necessárias

Defina em `.env.local` (local) ou nas configurações do provedor de hospedagem —
**apenas os nomes abaixo; nunca versione os valores** (veja `.env.example`):

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` (opcional)

## Implantação na Vercel (passo a passo)

O app é um projeto **Next.js** padrão, então a Vercel reconhece e configura tudo
automaticamente. Basta seguir os passos abaixo.

### 1. Entrar na Vercel
Acesse [vercel.com](https://vercel.com) e faça login com a conta do **GitHub**
dona deste repositório.

### 2. Importar o projeto
- Clique em **“Add New… → Project”**.
- Procure o repositório **`walletquantso`** e clique em **“Import”**.
- Deixe **Framework**, **Build Command** e **Output** no automático — a Vercel
  detecta Next.js sozinha.

### 3. Adicionar as variáveis do Firebase
Ainda na tela de importação, abra **“Environment Variables”** e adicione uma a
uma as variáveis listadas em [Variáveis de ambiente necessárias](#variáveis-de-ambiente-necessárias).
Todos os valores ficam no **Firebase Console → ⚙️ Configurações do projeto →
Seus apps → “Configuração do SDK”** — é só copiar e colar.

### 4. Publicar
Clique em **“Deploy”**. Em 1–2 minutos o app fica no ar em um endereço como
`walletquantso.vercel.app`.

### 5. Liberar o domínio no Firebase (para o login funcionar)
No **Firebase Console → Authentication → Settings → Authorized domains**,
adicione o domínio que a Vercel gerou (ex.: `walletquantso.vercel.app`).
Habilite também os provedores de login (E-mail/senha e Google) em
*Authentication → Sign-in method*.

### 6. Publicar as regras e os índices do Firestore (pelo Console — sem terminal)
Estes arquivos vão para o **Firebase**, não para a Vercel. Dá para publicar tudo
direto no navegador, sem instalar o Firebase CLI:

**Regras (`firestore.rules`):**
1. Firebase Console → **Firestore Database → aba Rules**.
2. Apague o conteúdo atual e **cole o texto do arquivo `firestore.rules`** deste
   repositório.
3. Clique em **Publish**.

**Índices (`firestore.indexes.json`):**
- Jeito mais fácil: **use o app normalmente**. Quando uma consulta precisar de um
  índice composto, o Firebase mostra no console do navegador um link
  **“Create index”** — clique nele e confirme; o índice é criado sozinho.
- Alternativa manual: Firebase Console → **Firestore Database → aba Indexes →
  Add index**, recriando cada índice conforme o `firestore.indexes.json`.

> Se preferir o terminal (Firebase CLI), os scripts `npm run deploy:rules` e
> `npm run deploy:indexes` continuam disponíveis — mas não são necessários.

### Deploys automáticos
Depois de conectado, **todo commit enviado ao `main` publica automaticamente**
uma nova versão na Vercel — não é preciso repetir os passos acima.

## Estrutura principal das pastas

```
app/                 Rotas (App Router): dashboard, lançamentos, contas a
                     pagar/receber, conciliação, fluxo de caixa, contas,
                     cartões, categorias, centros de custo, relatórios,
                     importação, auditoria, configurações.
src/components/      Componentes de UI (shell/menu, formulários, gráficos).
src/lib/             Lógica pura e testada (parsing BR, importação,
                     reconciliação, relatórios, exportação, saldos).
src/services/        Acesso ao Firebase (auth, firestore, import, etc.).
src/types/           Modelo de domínio (TypeScript).
public/              Ativos estáticos (logomarca).
firestore.rules      Regras de segurança (isolamento por usuário).
firestore.indexes.json  Índices compostos das consultas.
```
