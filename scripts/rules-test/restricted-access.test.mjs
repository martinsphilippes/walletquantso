import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { doc, getDoc, setDoc, addDoc, collection, getDocs, query, where, updateDoc, deleteDoc } from "firebase/firestore";

const OWNER = "owner-uid";
const MEMBER_EMAIL = "motorista@exemplo.com";
const results = [];
const check = async (label, p, expectOk) => {
  try { await (expectOk ? assertSucceeds(p) : assertFails(p)); results.push(`✅ ${label}`); }
  catch (e) { results.push(`❌ ${label}: ${String(e.message).slice(0, 140)}`); }
};

const env = await initializeTestEnvironment({
  projectId: "wq-rules-test",
  firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8089 },
});
await env.clearFirestore();

// Dados do dono já existentes (cliente, categoria) — semeados sem regras.
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "clients", "c1"), { ownerId: OWNER, name: "Gialla", zones: [], createdAt: 1 });
  await setDoc(doc(db, "transactions", "t1"), { ownerId: OWNER, amount: 10, type: "expense", date: "2026-09-01" });
  await setDoc(doc(db, "driverSettings", OWNER), { ownerId: OWNER, payDay: 5, diariaValue: 70, corridaValue: 8 });
});

const owner = env.authenticatedContext(OWNER, { email: "dono@exemplo.com" }).firestore();
const member = env.authenticatedContext("member-uid", { email: "Motorista@Exemplo.com" }).firestore(); // maiúsculas de propósito
const stranger = env.authenticatedContext("stranger-uid", { email: "outro@exemplo.com" }).firestore();

// 1. Dono lê o próprio doc members (inexistente) → permitido (retorna vazio)
await check("dono consulta members/{seu e-mail} ao entrar", getDoc(doc(owner, "members", "dono@exemplo.com")), true);

// 2. ANTES de liberar: o e-mail não enxerga clientes do dono
await check("antes de liberar: membro NÃO lista clientes do dono", getDocs(query(collection(member, "clients"), where("ownerId", "==", OWNER))), false);

// 3. Dono libera o e-mail (Acessos restritos)
await check("dono libera o e-mail em members", setDoc(doc(owner, "members", MEMBER_EMAIL), { ownerId: OWNER, email: MEMBER_EMAIL, role: "driver", label: null, createdAt: 1 }), true);
await check("dono lista seus acessos", getDocs(query(collection(owner, "members"), where("ownerId", "==", OWNER))), true);

// 4. Membro entra: lê seu doc members (e-mail com maiúsculas no token)
await check("membro lê members/{seu e-mail} ao entrar", getDoc(doc(member, "members", MEMBER_EMAIL)), true);

// 5. Membro pode: listar clientes, ler configuração, cadastrar motorista, lançar corrida, gerar título, marcar corrida
await check("membro lista clientes do dono (empresas)", getDocs(query(collection(member, "clients"), where("ownerId", "==", OWNER))), true);
await check("membro lê driverSettings do dono", getDoc(doc(member, "driverSettings", OWNER)), true);
await check("membro cadastra motorista", addDoc(collection(member, "drivers"), { ownerId: OWNER, name: "Josias", active: true, createdAt: 1, createdBy: MEMBER_EMAIL }), true);
let rideRef;
await check("membro lança corrida", (async () => { rideRef = await addDoc(collection(member, "rides"), { ownerId: OWNER, driverId: "d1", clientId: "c1", date: "2026-09-10", diarias: 1, corridas: 10, notes: null, createdAt: 1, createdBy: MEMBER_EMAIL, billId: null }); })(), true);
await check("membro lista corridas/motoristas do dono", getDocs(query(collection(member, "rides"), where("ownerId", "==", OWNER))), true);
await check("membro gera título a pagar (bills)", addDoc(collection(member, "bills"), { ownerId: OWNER, kind: "payable", description: "Motorista Josias", amount: 150, dueDate: "2026-10-05", payments: [], createdAt: 1 }), true);
await check("membro marca a corrida como faturada", updateDoc(doc(member, "rides", rideRef.id), { billId: "b1" }), true);

// 6. Membro NÃO pode: ver lançamentos/títulos, mexer em clientes, mudar configuração, gerenciar acessos, roubar ownerId
await check("membro NÃO lê transações do dono", getDocs(query(collection(member, "transactions"), where("ownerId", "==", OWNER))), false);
await check("membro NÃO lê títulos do dono", getDocs(query(collection(member, "bills"), where("ownerId", "==", OWNER))), false);
await check("membro NÃO edita cliente do dono", updateDoc(doc(member, "clients", "c1"), { ownerId: OWNER, name: "X" }), false);
await check("membro NÃO altera configuração de pagamento", setDoc(doc(member, "driverSettings", OWNER), { ownerId: OWNER, payDay: 1, diariaValue: 999, corridaValue: 999 }), false);
await check("membro NÃO lista/gerencia acessos", getDocs(query(collection(member, "members"), where("ownerId", "==", OWNER))), false);
await check("membro NÃO libera outro e-mail", setDoc(doc(member, "members", "amigo@exemplo.com"), { ownerId: OWNER, email: "amigo@exemplo.com", role: "driver", createdAt: 1 }), false);
await check("membro NÃO transfere corrida para outro dono", updateDoc(doc(member, "rides", rideRef.id), { ownerId: "member-uid" }), false);

// 7. Estranho (e-mail não liberado) não vê nada
await check("estranho NÃO lista clientes do dono", getDocs(query(collection(stranger, "clients"), where("ownerId", "==", OWNER))), false);
await check("estranho NÃO lança corrida em nome do dono", addDoc(collection(stranger, "rides"), { ownerId: OWNER, driverId: "d1", clientId: "c1", date: "2026-09-10", diarias: 1, corridas: 1, createdAt: 1, createdBy: "x", billId: null }), false);

// 8. Dono remove o acesso → membro perde tudo
await check("dono remove o acesso", deleteDoc(doc(owner, "members", MEMBER_EMAIL)), true);
await check("após remoção: membro NÃO lista mais as corridas", getDocs(query(collection(member, "rides"), where("ownerId", "==", OWNER))), false);

await env.cleanup();
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("❌")).length;
console.log(`\n${results.length - failed}/${results.length} cenários OK`);
process.exit(failed ? 1 : 0);
