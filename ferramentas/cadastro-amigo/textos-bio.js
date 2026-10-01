// Orientações da bioimpedância (consulta presencial) em português, espanhol e inglês.
// Usado pelos botões "Mensagem do exame" e "Confirmar consulta" (o gerar-botoes.js insere no lugar de /*BIO*/).
const BIO = {
  pt: '*Orientações para o exame de bioimpedância e documentação de fotos*\n' +
    '_Para garantir precisão nas medições, siga as orientações:_\n' +
    '• Jejum de 4 horas (sólidos e líquidos);\n• Não ingerir bebidas alcoólicas nas 8 horas anteriores;\n• Evitar café, chás escuros e chocolates;\n' +
    '• Evitar atividade física intensa e sauna no dia anterior;\n• Evitar realizar o exame no período menstrual;\n• Esvaziar a bexiga antes do exame;\n' +
    '• Remover metais do corpo (brincos, anéis, piercings etc.).\n\n' +
    '*📸 Registro fotográfico (recomendado):*\nPara melhor padronização e comparação da evolução, dê preferência a biquíni *preto* ou roupa íntima *preta de modelo menor* (calcinha pequena e sutiã). Peças maiores ou de outras cores dificultam a análise. Recomendação técnica, sem obrigatoriedade.\n\n' +
    '*Quem não pode realizar o exame?*\n• Usuários de marcapasso ou aparelhos elétricos implantados;\n• Pessoas com peças metálicas internas (placas e parafusos);\n• Gestantes ou suspeita de gestação.',
  es: '*Indicaciones para el examen de bioimpedancia y registro de fotos*\n' +
    '_Para garantizar la precisión de las mediciones, sigue estas indicaciones:_\n' +
    '• Ayuno de 4 horas (sólidos y líquidos);\n• No tomar bebidas alcohólicas en las 8 horas anteriores;\n• Evitar café, tés oscuros y chocolate;\n' +
    '• Evitar actividad física intensa y sauna el día anterior;\n• Evitar hacer el examen durante el período menstrual;\n• Vaciar la vejiga antes del examen;\n' +
    '• Retirar los objetos de metal del cuerpo (aretes, anillos, piercings, etc.).\n\n' +
    '*📸 Registro fotográfico (recomendado):*\nPara una mejor estandarización y comparación de la evolución, preferiblemente usa bikini *negro* o ropa interior *negra de modelo pequeño* (braga pequeña y sujetador). Las prendas más grandes o de otros colores dificultan el análisis. Es una recomendación técnica, no una obligación.\n\n' +
    '*¿Quién no puede hacer el examen?*\n• Personas con marcapasos o dispositivos eléctricos implantados;\n• Personas con piezas metálicas internas (placas y tornillos);\n• Embarazadas o con sospecha de embarazo.',
  en: '*Instructions for the bioimpedance test and photo record*\n' +
    '_To make sure the measurements are accurate, please follow these instructions:_\n' +
    '• Fast for 4 hours (no food or drinks);\n• No alcohol in the 8 hours before;\n• Avoid coffee, dark teas and chocolate;\n' +
    '• Avoid intense exercise and sauna the day before;\n• Avoid taking the test during your period;\n• Empty your bladder before the test;\n' +
    '• Remove any metal from your body (earrings, rings, piercings, etc.).\n\n' +
    '*📸 Photo record (recommended):*\nFor better standardization and comparison over time, we recommend a *black* bikini or *small black* underwear (small briefs and bra). Larger pieces or other colors make the analysis harder. This is a technical recommendation, not a requirement.\n\n' +
    '*Who cannot take the test?*\n• People with a pacemaker or implanted electrical devices;\n• People with internal metal parts (plates and screws);\n• Pregnant women or anyone who may be pregnant.',
};
if (typeof module !== 'undefined') module.exports = { BIO };
