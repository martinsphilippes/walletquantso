"use client";

import { LoginGate } from "@/components/LoginGate";
import { PedidosWhatsAppTool } from "@/components/PedidosWhatsAppTool";

export default function PedidosWhatsAppPage() {
  return (
    <>
      <h1>Pedidos WhatsApp</h1>
      <p className="muted">
        Converta uma conversa do WhatsApp (colada ou por foto/print) em planilha, com colunas
        Manhã/Tarde, Cotação, Bairro, Telefone e Dia.
      </p>
      <LoginGate>
        <PedidosWhatsAppTool />
      </LoginGate>
    </>
  );
}
