from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import textwrap


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf" / "strategie_arnaud_positions_2026-06-09.pdf"

PAGE_W = 595
PAGE_H = 842
MARGIN = 44
CONTENT_W = PAGE_W - 2 * MARGIN


def pdf_escape(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace("(", "\\(")
        .replace(")", "\\)")
    )


def enc(text: str) -> bytes:
    return text.encode("latin-1", errors="replace")


@dataclass
class Page:
    title: str
    parts: list[tuple[str, list[str]]]


PAGES = [
    Page(
        "Plan de jeu - session 500 / 1000, option 2000",
        [
            (
                "Objectif",
                [
                    "Strategie visee: limp controle + grosses relances avec premiums + adaptation forte a la position.",
                    "Note population: a 2000, personne ne couche vraiment. 2K sert a entrer dans le coup, pas a faire folder.",
                    "Ne pas faire de relances moyennes avec des mains moyennes: a cette table, 4000-7000 ne casse pas le train.",
                    "La simulation favorise des premiums a 10000-12000, plus 1500-2000 par caller, plus bonus position/dead money.",
                    "But realiste: EV positif et bons gros scores. Depasser 50% de sessions gagnantes reste difficile vu la variance multiway.",
                ],
            ),
            (
                "Regle simple",
                [
                    "Table aujourd'hui, ordre fourni: Moi, Eric B, Pierre, David, Guillaume, Bruno, Pascal 2, Fabrice.",
                    "Hypothese de lecture: Eric B agit juste apres toi dans cet ordre; Fabrice est juste avant toi.",
                    "Mains moyennes jouables: entrer seulement si le prix final est stable ou tres bon.",
                    "Mains fortes: faire payer cher tout de suite.",
                    "Pots a 5-7 joueurs: value fort quand tu touches vraiment, bluff rarement.",
                ],
            ),
            (
                "Combo conseillee par le simulateur",
                [
                    "Base solide: premium 10000-12000.",
                    "Ajouter 1500-2000 par joueur deja entre.",
                    "Ajouter 3000-4000 en position avec beaucoup de dead money.",
                    "AA / KK: pression maximale possible, parfois tapis preflop selon pot et profils.",
                ],
            ),
        ],
    ),
    Page(
        "Lecture de table - les profils qui changent tout",
        [
            (
                "Call train",
                [
                    "Si Eric B entre ou met de la pression, Pierre peut suivre derriere si le prix lui semble acceptable.",
                    "A 2000, considerer que tout le monde continue sauf vraie poubelle ou decision deja faite de ne pas jouer.",
                    "Si Pierre call, le pot devient attractif pour les profils curieux ou recreatifs.",
                    "Si Fabrice n'a pas encore parle, il peut encore faire monter le prix ou punir un sizing trop faible.",
                    "Jesus / Gilles peut justifier presque any two preflop: ne pas chercher a le faire folder avec un sizing moyen.",
                ],
            ),
            (
                "Fabrice a gauche de toi",
                [
                    "Danger principal: il transforme tes petits opens en multiway, surtout si un ou deux joueurs ont deja call.",
                    "Regle pivot: si Fabrice n'a pas encore parle et peut faire exploser le prix, tu resserres fortement.",
                    "Solution: reduire les opens moyens; choisir limp ou tres grosse relance.",
                    "Avec main moyenne, preferer limp/fold ou limp/call bon prix plutot qu'open 6000-8000.",
                ],
            ),
            (
                "Fabrice a droite de toi",
                [
                    "Meilleur contexte: tu vois s'il entre avant de decider.",
                    "Regle pivot: si Fabrice a deja fixe son intention, tu peux jouer la main selon les cotes.",
                    "S'il limp et que plusieurs suivent, tu peux attaquer cher en position avec premium.",
                    "Avec speculative correcte, tu peux prendre le prix si le pot est enorme et le cout final connu.",
                ],
            ),
        ],
    ),
    Page(
        "Positions totales - UTG, UTG+1, milieu",
        [
            (
                "UTG / debut de parole",
                [
                    "Range serree. Tu n'as pas encore le prix final et tu peux declencher tout le train.",
                    "Limp possible: 88-TT, AJs/AQs si table tres passive, KQs, QJs, JTs suited.",
                    "Fold plus souvent: Q9, J9, QT off, A8/A9 off, petits connecteurs non suited.",
                    "Raise fort: AA, KK, QQ, JJ, AK, AQs/AJs selon dynamique.",
                ],
            ),
            (
                "Milieu",
                [
                    "Tu peux elargir si les relanceurs naturels sont a gauche et que le prix apparait vite.",
                    "Limp/call bon prix: 77-TT, KQ, KJ suited, QJ, JT, QT suited, A8s-AJs.",
                    "Attention si Eric B/Pierre ont deja call: le train devient probable.",
                    "Avec premium, sizing souvent 12000+ car dead money deja present.",
                ],
            ),
        ],
    ),
    Page(
        "Cutoff / bouton - la zone d'attaque",
        [
            (
                "Quand beaucoup ont limp avant toi",
                [
                    "C'est ton meilleur spot pour punir avec premium.",
                    "Sizing conseille: 12000 de base, +1500-2000 par limper, parfois 15000-22000 si 4+ joueurs.",
                    "Ne jamais compter sur 2000 pour voler le pot: c'est un ticket d'entree collectif.",
                    "Objectif: isoler ou prendre dead money, pas offrir un prix de groupe.",
                ],
            ),
            (
                "Range limp/call en position",
                [
                    "OK si prix stable: 77-TT, JTs, QTs, KJs, KQ, A8s-AJs, Q9s, J9s.",
                    "Mains offsuit moyennes: beaucoup plus prudentes, surtout si joueurs sticky derriere.",
                    "Si Jesus est deja dans le coup, garde l'avantage positionnel mais evite les bluffs compliques.",
                ],
            ),
            (
                "Quand Fabrice est dans les blindes",
                [
                    "Il va defendre large si le pot est deja gros.",
                    "Tes petits steals perdent de la valeur.",
                    "Avec premium: plus cher. Avec moyen: limp/check back plus souvent.",
                ],
            ),
        ],
    ),
    Page(
        "Blindes et option 2000",
        [
            (
                "Option: decision par position des relanceurs",
                [
                    "Option meilleure si le relanceur principal est immediatement a ta gauche: tu vois vite le vrai prix.",
                    "L'option a 2000 ne fait folder personne; elle cree surtout un pot plus gros et plus de calls.",
                    "Option dangereuse si le relanceur principal est a ta droite: tu postes 2000 puis tu peux subir open + 3-bet.",
                    "Ne pas prendre l'option automatiquement avec mains moyennes si la structure autour de toi est agressive.",
                ],
            ),
            (
                "Exemples de mains en option",
                [
                    "Principe central: Fabrice deja fixe = decision par les cotes; Fabrice encore a parler = range beaucoup plus serree.",
                    "99 / 88 / 77: call volontiers si 3000-4000 a ajouter dans un pot enorme et prix connu.",
                    "JT / QT / Q9 / J9: OK si suited ou bon prix multiway stable; fold si prix instable.",
                    "KQ / KJ / A9 / A8: jouables, mais pas pour se faire enfermer entre raise et 3-bet.",
                ],
            ),
            (
                "Small blind / big blind",
                [
                    "Hors position, resserrer les mains offsuit.",
                    "Completer bon prix avec mains qui font gros jeu: paires, suited connectors, suited broadways.",
                    "Face a raise cher + callers: continuer surtout premiums, paires jouables avec cote claire, suited forts.",
                ],
            ),
        ],
    ),
    Page(
        "Formats rapides selon voisinage",
        [
            (
                "Fabrice / Eric B / Pierre a gauche",
                [
                    "Ils augmentent la probabilite de calls en chaine.",
                    "Si Fabrice n'a pas encore parle, considere que le prix peut exploser: resserre tres fort.",
                    "Plan: moins d'open medium. Plus de limp controle ou raise tres cher.",
                    "Premium: 12000-15000 minimum si un ou deux limpers; 18000+ si le train est deja lance.",
                    "Moyen: ne pas gonfler le pot hors position avec KQ, KJ, QT, 88 si tu n'es pas pret a jouer multiway.",
                ],
            ),
            (
                "Ces profils a droite",
                [
                    "Tu gagnes de l'information. Tu peux punir les limps en position.",
                    "Si Fabrice a deja fixe son intention, tu peux revenir a une logique de cotes et de position.",
                    "Si 3-4 joueurs ont limp, tes premiums doivent prendre le pot tout de suite ou partir contre moins de monde.",
                    "Avec mains speculatives, tu peux prendre les cotes si le prix final est clair.",
                ],
            ),
            (
                "Jesus proche de toi",
                [
                    "Ne pas essayer de le faire folder avec sizing moyen.",
                    "Value plus large quand tu as top pair solide ou mieux.",
                    "Bluff seulement si le board et la sequence racontent une histoire tres forte.",
                ],
            ),
        ],
    ),
    Page(
        "Checklist avant de mettre des jetons",
        [
            (
                "Les 5 questions",
                [
                    "1. Est-ce que mon prix final est connu ou peut exploser apres moi ?",
                    "2. Qui peut lancer le train de calls derriere moi ?",
                    "3. Fabrice est-il deja dans le coup ou encore a parler ?",
                    "4. Ma main veut-elle un petit pot multiway ou un gros pot preflop ?",
                    "5. Si je relance, est-ce que mon sizing casse vraiment le jeu ?",
                ],
            ),
            (
                "Decision express",
                [
                    "Fabrice deja fixe = jouer selon les cotes.",
                    "Fabrice encore a parler = resserrer fortement.",
                    "Mise/option a 2000 = zero fold equity pratique.",
                    "Prix instable + main moyenne = fold plus souvent.",
                    "Prix stable + pot enorme + main speculative correcte = call possible.",
                    "Premium + dead money = raise tres cher.",
                    "Premium + train deja lance = 15000-22000 ou pression max selon profondeur.",
                ],
            ),
        ],
    ),
]


def wrap_line(line: str, width: int = 88) -> list[str]:
    if not line:
        return [""]
    return textwrap.wrap(line, width=width, break_long_words=False, replace_whitespace=False)


def text_op(x: float, y: float, size: int, text: str, font: str = "F1", color: tuple[float, float, float] = (0, 0, 0)) -> str:
    r, g, b = color
    return f"{r:.3f} {g:.3f} {b:.3f} rg BT /{font} {size} Tf {x:.1f} {y:.1f} Td ({pdf_escape(text)}) Tj ET\n"


def rect_op(x: float, y: float, w: float, h: float, color: tuple[float, float, float]) -> str:
    r, g, b = color
    return f"{r:.3f} {g:.3f} {b:.3f} rg {x:.1f} {y:.1f} {w:.1f} {h:.1f} re f\n"


def build_page(page: Page, page_no: int, total: int) -> bytes:
    ops = []
    ops.append(rect_op(0, 0, PAGE_W, PAGE_H, (1, 1, 1)))
    ops.append(rect_op(0, PAGE_H - 76, PAGE_W, 76, (0.070, 0.110, 0.130)))
    ops.append(text_op(MARGIN, PAGE_H - 44, 19, page.title, "F2", (1, 1, 1)))
    ops.append(text_op(MARGIN, PAGE_H - 62, 8, "Fiche tactique personnelle - table loose / call train", "F1", (0.78, 0.86, 0.86)))

    y = PAGE_H - 110
    accent = (0.820, 0.160, 0.110)
    dark = (0.095, 0.120, 0.125)
    body = (0.140, 0.150, 0.150)
    muted = (0.380, 0.410, 0.410)

    for heading, lines in page.parts:
        needed = 32 + sum(len(wrap_line(line)) * 13 + 4 for line in lines)
        if y - needed < 58:
            ops.append(text_op(MARGIN, 32, 8, f"Page {page_no}/{total}", "F1", muted))
            return enc("".join(ops))

        ops.append(rect_op(MARGIN, y - 4, 5, 17, accent))
        ops.append(text_op(MARGIN + 13, y, 13, heading, "F2", dark))
        y -= 23
        for line in lines:
            wrapped = wrap_line(line)
            for idx, part in enumerate(wrapped):
                prefix = "- " if idx == 0 and not part[:2].isdigit() else "  "
                if part[:2].isdigit():
                    prefix = ""
                ops.append(text_op(MARGIN + 8, y, 10, prefix + part, "F1", body))
                y -= 13
            y -= 4
        y -= 10

    ops.append(text_op(MARGIN, 32, 8, f"Page {page_no}/{total}", "F1", muted))
    return enc("".join(ops))


def make_pdf(pages: list[Page]) -> bytes:
    objects: list[bytes] = []

    def add(obj: bytes) -> int:
        objects.append(obj)
        return len(objects)

    catalog_id = add(b"")
    pages_id = add(b"")
    font_regular_id = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    font_bold_id = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")

    page_ids = []
    content_ids = []
    for idx, page in enumerate(pages, start=1):
        stream = build_page(page, idx, len(pages))
        content_id = add(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"endstream")
        page_id = add(
            f"<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] "
            f"/Resources << /Font << /F1 {font_regular_id} 0 R /F2 {font_bold_id} 0 R >> >> "
            f"/Contents {content_id} 0 R >>".encode()
        )
        content_ids.append(content_id)
        page_ids.append(page_id)

    objects[catalog_id - 1] = f"<< /Type /Catalog /Pages {pages_id} 0 R >>".encode()
    kids = " ".join(f"{pid} 0 R" for pid in page_ids)
    objects[pages_id - 1] = f"<< /Type /Pages /Kids [{kids}] /Count {len(page_ids)} >>".encode()

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for number, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref_at = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for off in offsets[1:]:
        out += f"{off:010d} 00000 n \n".encode()
    out += (
        b"trailer\n"
        + f"<< /Size {len(objects) + 1} /Root {catalog_id} 0 R >>\n".encode()
        + b"startxref\n"
        + str(xref_at).encode()
        + b"\n%%EOF\n"
    )
    return bytes(out)


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(make_pdf(PAGES))
    print(OUT)


if __name__ == "__main__":
    main()
