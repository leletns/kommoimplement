# Gera comprovantes FICTÍCIOS com cara de foto de celular (para o teste de ponta a ponta do lote):
#   maquininha-visa.jpg  → via do cliente de maquininha (Stone), Visa crédito 3x, foto torta e com sombra
#   nota-fiscal-foto.jpg → NFS-e impressa e fotografada
# Uso: python3 test/fixtures/gerar-comprovantes-foto.py
import os, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

AQUI = os.path.join(os.path.dirname(__file__), 'comprovantes')
MONO = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'
SANS = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'
SANSB = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'
random.seed(7)

def foto(papel, angulo, saida, fundo=(92, 84, 76)):
    # papel sobre a mesa, girado, com sombra de um lado, um pouco desfocado e com ruído
    w, h = papel.size
    tela = Image.new('RGB', (w + 260, h + 260), fundo)
    sombra = Image.new('L', papel.size, 0)
    papel_rgba = papel.convert('RGBA').rotate(angulo, expand=True, fillcolor=(0, 0, 0, 0), resample=Image.BICUBIC)
    tela.paste(papel_rgba, (130 - (papel_rgba.width - w) // 2, 130 - (papel_rgba.height - h) // 2), papel_rgba)
    grad = Image.linear_gradient('L').resize(tela.size).rotate(90)
    escuro = Image.new('RGB', tela.size, (0, 0, 0))
    tela = Image.composite(tela, escuro, grad.point(lambda v: 150 + v * 105 // 255))
    px = tela.load()
    for _ in range(tela.width * tela.height // 25):
        x, y = random.randrange(tela.width), random.randrange(tela.height)
        r, g, b = px[x, y]; d = random.randint(-18, 18)
        px[x, y] = (max(0, min(255, r + d)), max(0, min(255, g + d)), max(0, min(255, b + d)))
    tela = tela.filter(ImageFilter.GaussianBlur(0.7))
    tela.save(os.path.join(AQUI, saida), quality=82)

def maquininha():
    f = ImageFont.truetype(MONO, 26); fb = ImageFont.truetype(MONO, 30)
    linhas = [('STONE', fb), ('', f), ('VIA CLIENTE', f), ('CLINICA BLUE LTDA', f), ('CNPJ 12.345.678/0001-90', f), ('', f), ('VISA CREDITO', fb), ('************1234', f),
              ('PARCELADO LOJA 3X', f), ('', f), ('VALOR: R$ 1.800,00', fb), ('3 X R$ 600,00', f), ('', f), ('06/10/2026 14:22', f), ('NSU: 004512', f), ('AUT: A1B2C3', f), ('', f), ('TRANSACAO AUTORIZADA', f), ('MEDIANTE USO DE SENHA', f)]
    papel = Image.new('RGB', (560, 60 + 40 * len(linhas)), (246, 244, 238))
    d = ImageDraw.Draw(papel)
    for i, (t, fo) in enumerate(linhas):
        tw = d.textlength(t, font=fo); d.text(((560 - tw) / 2, 30 + i * 40), t, fill=(38, 38, 44), font=fo)
    foto(papel, 4, 'maquininha-visa.jpg')

def nota():
    f = ImageFont.truetype(SANS, 24); fb = ImageFont.truetype(SANSB, 26); ft = ImageFont.truetype(SANSB, 30)
    linhas = [('PREFEITURA DA CIDADE DO RIO DE JANEIRO', ft), ('NOTA FISCAL DE SERVIÇOS ELETRÔNICA - NFS-e', fb), ('Número da Nota: 2871', f), ('Data e Hora de Emissão: 06/10/2026 10:15:30', f), ('', f),
              ('PRESTADOR DE SERVIÇOS', fb), ('Razão Social: CLINICA BLUE LTDA', f), ('CNPJ: 12.345.678/0001-90', f), ('', f),
              ('TOMADOR DE SERVIÇOS', fb), ('Nome/Razão Social: Beatriz Lima Costa', f), ('CPF/CNPJ: 529.982.247-25', f), ('', f),
              ('DISCRIMINAÇÃO DOS SERVIÇOS', fb), ('Soroterapia - ferro e vitamina D', f), ('', f), ('VALOR TOTAL DA NOTA = R$ 900,00', fb), ('Base de Cálculo (R$) 900,00', f), ('Alíquota (%) 2,00', f), ('Valor do ISS (R$) 18,00', f)]
    papel = Image.new('RGB', (860, 60 + 38 * len(linhas)), (250, 250, 250))
    d = ImageDraw.Draw(papel)
    for i, (t, fo) in enumerate(linhas): d.text((40, 30 + i * 38), t, fill=(20, 20, 20), font=fo)
    foto(papel, -3, 'nota-fiscal-foto.jpg', fundo=(170, 150, 120))

maquininha(); nota(); print('ok')
