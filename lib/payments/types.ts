export type ProviderId = 'webpay' | 'mercadopago' | 'flow' | 'stripe' | 'fintoc';

export type OrderInfo = {
  id: string; number: number; amount: number; currency: string; title: string; email: string; name: string;
  /** Banco elegido por el comprador (solo «Paga con tu banco»). */
  bank?: string;
};

/** Cómo se envía al comprador a la página segura del proveedor. */
export type StartResult = { reference: string; redirect: { method: 'GET' | 'POST'; url: string; fields?: Record<string, string> } };

/** Resultado verificado servidor-a-servidor con el proveedor (nunca con datos del navegador). */
export type Verification = {
  orderId: string; reference: string; paid: boolean; amount: number; currency: string; status: string; payload: unknown;
};

export interface PaymentProvider {
  id: ProviderId;
  label: string;
  description: string;
  currencies: string[];
  enabled(): boolean;
  /** Bancos para elegir antes de pagar (opcional). */
  banks?: { id: string; name: string }[];
  start(order: OrderInfo, urls: { returnUrl: string; notifyUrl: string; cancelUrl: string }): Promise<StartResult>;
}
