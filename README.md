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

## Implantação

1. Configure as variáveis de ambiente acima no provedor (ex.: Vercel).
2. Publique as regras e índices do Firestore (versionados neste repositório):
   ```bash
   firebase login
   npm run deploy:firestore   # firestore.rules + firestore.indexes.json
   ```
3. No Firebase Console, habilite os provedores de login (E-mail/senha e Google)
   e adicione o domínio de produção em *Authentication → Authorized domains*.

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
