#!/usr/bin/env python3
"""Extraction en masse des profils de course PCM (.cds) vers du JSON (bibliothèques standard uniquement)."""
import json
import math
import os
import re
import struct
import sys

DOSSIER_ENTREE = "dossier_cds"
DOSSIER_SORTIE = "output_json"
MIN_POINTS = 30                    # une liste de moins de 30 points n'est pas un profil
ALT_MIN_OK, ALT_MAX_OK = -300.0, 6000.0


def lire_textes(data):
    """Textes ASCII du fichier (nom de l'étape...)."""
    return [t.strip() for t in re.findall(rb"[\x20-\x7e]{4,}", data) for t in [t.decode("ascii")] if t.strip()]


def chercher_listes(data, inverse):
    """Trouve les listes de paires (distance, altitude) en float32 little-endian, la distance étant strictement croissante."""
    n, listes, p = len(data), [], 0
    while p + 8 <= n:
        q, prec, pts = p, float("-inf"), []
        while q + 8 <= n:
            a, b = struct.unpack_from("<ff", data, q)
            x, y = (b, a) if inverse else (a, b)
            if not (math.isfinite(x) and math.isfinite(y)) or abs(x) > 1e6 or y < ALT_MIN_OK or y > ALT_MAX_OK or x <= prec:
                break
            pts.append((x, y))
            prec = x
            q += 8
        if len(pts) >= MIN_POINTS and max(p[1] for p in pts) - min(p[1] for p in pts) > 5:
            listes.append(pts)
            p = q
        else:
            p += 1
    return listes


def distances_entete(data):
    """Distances possibles écrites au début du fichier (pour comparaison)."""
    out = []
    for o in range(0, min(len(data) - 4, 400)):
        v = struct.unpack_from("<f", data, o)[0]
        if not math.isfinite(v):
            continue
        if 20000 <= v <= 300000:
            out.append(round(v / 1000, 1))
        elif 20 <= v <= 300 and abs(v - round(v)) < 1e-3:
            out.append(int(round(v)))
    return sorted(set(out))[:6]


def construire_etape(pts):
    """Convertit une liste (distance, altitude) en profil : km, altitude, pente en %."""
    x0 = pts[0][0]
    span = pts[-1][0] - x0
    div = 1000.0 if span > 1000 else 1.0           # distances en mètres si l'amplitude dépasse 1000
    km = [(x - x0) / div for x, _ in pts]
    alt = [y for _, y in pts]
    pente = []
    for i in range(len(pts)):
        j = i if i < len(pts) - 1 else i - 1       # dernier point : pente du segment précédent
        dist_m = (km[j + 1] - km[j]) * 1000.0
        pente.append(((alt[j + 1] - alt[j]) / dist_m) * 100.0 if dist_m > 0 else 0.0)
    denivele = sum(max(0.0, alt[i + 1] - alt[i]) for i in range(len(alt) - 1))
    return {
        "nb_points": len(pts),
        "distance_km": round(km[-1], 3),
        "alt_min": round(min(alt), 1),
        "alt_max": round(max(alt), 1),
        "denivele_positif_m": round(denivele),
        "pente_max_pct": round(max(pente), 1),
        "pente_min_pct": round(min(pente), 1),
        "champs": ["km", "alt", "pente_pct"],
        "points": [[round(km[i], 3), round(alt[i], 1), round(pente[i], 2)] for i in range(len(pts))],
    }


def traiter_fichier(chemin):
    with open(chemin, "rb") as f:
        data = f.read()
    textes = lire_textes(data)
    nom = next((t for t in textes if " - " in t or " > " in t), None) or os.path.splitext(os.path.basename(chemin))[0]
    listes = chercher_listes(data, False) + chercher_listes(data, True)
    if not listes:
        raise ValueError("aucune liste distance/altitude trouvée")
    listes.sort(key=len, reverse=True)
    etape = construire_etape(listes[0])             # la plus longue liste = le profil
    etape["nom"] = nom.rstrip(". ")
    etape["autres_listes_trouvees"] = len(listes) - 1
    etape["distances_entete_possibles_km"] = distances_entete(data)
    avert = []
    if etape["distance_km"] < 5:
        avert.append("distance très courte")
    if etape["pente_max_pct"] > 18 or etape["pente_min_pct"] < -18:
        avert.append("pentes irréalistes : altitudes peut-être mal échelonnées")
    if len(listes) > 1:
        avert.append(f"{len(listes) - 1} autre(s) liste(s) de données dans le fichier")
    etape["avertissements"] = avert
    return etape


def main():
    if not os.path.isdir(DOSSIER_ENTREE):
        sys.exit(f"Dossier introuvable : « {DOSSIER_ENTREE} ». Créez-le à côté du script et placez-y les .cds.")
    fichiers = sorted(f for f in os.listdir(DOSSIER_ENTREE) if f.lower().endswith(".cds"))
    if not fichiers:
        sys.exit(f"Aucun fichier .cds dans « {DOSSIER_ENTREE} ».")
    os.makedirs(DOSSIER_SORTIE, exist_ok=True)

    index, erreurs = [], []
    for n, nom_fichier in enumerate(fichiers, 1):
        try:
            etape = traiter_fichier(os.path.join(DOSSIER_ENTREE, nom_fichier))
        except Exception as e:                       # un fichier illisible n'arrête pas le traitement
            erreurs.append((nom_fichier, str(e)))
            print(f"[{n}/{len(fichiers)}] ECHEC  {nom_fichier} : {e}")
            continue
        etape["id"] = n
        etape["fichier_source"] = nom_fichier
        json_name = f"etape_{n}.json"
        with open(os.path.join(DOSSIER_SORTIE, json_name), "w", encoding="utf-8") as f:
            json.dump(etape, f, ensure_ascii=False, separators=(",", ":"))
        index.append({k: etape[k] for k in ("id", "nom", "fichier_source", "distance_km", "denivele_positif_m", "alt_min", "alt_max", "pente_max_pct", "nb_points", "avertissements")} | {"fichier_json": json_name})
        flag = "  /!\\ " + "; ".join(etape["avertissements"]) if etape["avertissements"] else ""
        print(f"[{n}/{len(fichiers)}] ok     {nom_fichier} -> {json_name} ({etape['distance_km']} km, {etape['alt_min']}-{etape['alt_max']} m){flag}")

    with open(os.path.join(DOSSIER_SORTIE, "index_courses.json"), "w", encoding="utf-8") as f:
        json.dump({"nombre": len(index), "courses": index}, f, ensure_ascii=False, indent=1)
    avert = sum(1 for c in index if c["avertissements"])
    print(f"\nTerminé : {len(index)} fichier(s) convertis, {len(erreurs)} échec(s), {avert} avec avertissement(s).")
    if erreurs:
        with open(os.path.join(DOSSIER_SORTIE, "erreurs.txt"), "w", encoding="utf-8") as f:
            f.write("\n".join(f"{n} : {e}" for n, e in erreurs))
        print("Liste des échecs : output_json/erreurs.txt")


if __name__ == "__main__":
    main()
