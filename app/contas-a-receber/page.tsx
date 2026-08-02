import { LoginGate } from "@/components/LoginGate";
import { BillsManager } from "@/components/BillsManager";

export default function Page() {
  return (
    <>
      <h1>Contas a receber</h1>
      <LoginGate>
        <BillsManager kind="receivable" />
      </LoginGate>
    </>
  );
}
