# UK market configuration — London / England

Projeto para brasileiros residentes em Londres e região, com interface em português e preços mostrados em reais, sujeito às regras aplicáveis no Reino Unido.

## Initial scope
- Interface: pt-BR (português para brasileiros residentes no Reino Unido)
- Display currency: BRL (R$). A liquidação efetiva depende do adquirente, conta bancária e câmbio aplicáveis
- Time zone: Europe/London, daylight saving time aware
- Phone: accept UK (+44) and Brazil (+55), plus international numbers according to identity verification and applicable eligibility rules
- Geographic eligibility: England initially; do not assume identical rules across the entire UK
- Provisional campaign price: R$ 50 per paid entry, proposed only; do not activate payment until compliant campaign classification and payment provider approval
- Competition: two used laptops (Dell Core i5 4th gen, 4GB, 240GB SSD; HP Core i3 7th gen, 8GB, 240GB SSD)
- Proposed interface: public prize gallery; numbers grid; distinct free and paid entry routes; registration and login; 3-minute temporary reservation; status and transaction history
- A validação atual de telefone continua limitada a +55; deve ser adaptada para +44 e números internacionais antes do uso no Reino Unido.
- Interface em português, preço exibido em reais, horário em Europe/London, mas operação/consumidor situados no Reino Unido: idioma e moeda não afastam exigências legais britânicas.

## Compliance controls required before paid launch
- Determine and document whether the campaign is a qualifying free draw with an equal-access genuine free route or a genuine skill-based prize competition.
- Free-entry route must satisfy Gambling Commission guidance and consumer/advertising law. Implement entry parity, closing dates, clear rules, draw audit, winner publication/privacy and age safeguards. A free option must not be illusory.
- Treat any unqualified payment-plus-chance offering as an unauthorized lottery; do not activate paid entry for it.
- Comply with UK GDPR and Data Protection Act 2018, UK consumer protection and ASA/CAP advertising code.
- Assess the 2025 voluntary code for prize draw operators and recommended controls.
- Obtain UK legal review and acquiring provider approval, including classification of the activity.
- Asaas is a Brazil-focused service; do not assume it supports UK merchant acquisition or this category. Select a payment provider which explicitly approves UK prize draws.

## Moeda de apresentação e cobrança
- Uma etiqueta R$ 50 no site não garante que o cartão/PIX será processado em BRL. Confirmar moeda de cobrança, conversão, reembolso, tarifas e informação clara ao consumidor.
- PIX depende de recebedor e provedor habilitados. Não pressupor conta Asaas britânica.

## Proposed payment lifecycle (for approved paid entry campaigns only)
1. Lock chosen numbers for 3 minutes using server-side UTC expiry.
2. Create checkout with unique order ID and approved payment provider.
3. Verify signed webhook server-side and provider status; mark paid atomically and convert reserved numbers to confirmed entries.
4. If payment is not completed before expiry, release held numbers. For late settlement, **do not allocate already released numbers**; enter manual reconciliation/refund process consistent with the published terms.
5. Free-entry route goes through separate validated workflow with equal treatment and auditable allocation. No forced purchase.
6. Prevent duplicate webhook processing and implement idempotent payment/order mapping.

## References
- https://www.gamblingcommission.gov.uk/public-and-players/guide/page/free-draws-and-prize-competitions
- https://www.gov.uk/government/publications/voluntary-code-of-good-practice-for-prize-draw-operators/voluntary-code-of-good-practice-for-prize-draw-operators
- https://www.asa.org.uk/advice-online/promotional-marketing-free-entry-routes.html

## Status
This file documents requirements; UK payment processing and compliance checks are **not implemented**.
