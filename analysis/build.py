"""Construction des tables du tableau de bord (courbes d'âge NBA).

Usage : python3 -I build.py <dossier_données> <dossier_sortie>
"""
import sys, os, zlib, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import pandas as pd
import lib, robust

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
T0 = time.time()

AGES = np.arange(18, 44)
H, NMIN, B = 4.5, 30, 300
ERAS = {"all": (1974, 2026), "1974-1989": (1974, 1989), "1990-1999": (1990, 1999),
        "2000-2009": (2000, 2009), "2010-2019": (2010, 2019), "2020-2026": (2020, 2026)}
POS = ["all", "G", "F", "C"]
THR = [250, 500, 1000, 1500]
TOLS = [10, 20, 30]                       # tolérance, en centièmes d'écart-type
ORDER = ["bpm", "ws48", "per", "vorp82", "ws82", "obpm", "dbpm", "ts_rel", "usg", "ast", "trb", "stl", "blk", "mpg", "gp_share"]
DEC = dict(bpm=3, ws48=5, per=3, vorp82=3, ws82=3, obpm=3, dbpm=3, ts_rel=3, usg=3, ast=3, trb=3, stl=3, blk=3, mpg=3, gp_share=3)


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


def fnum(x, dec):
    """Texte d'un nombre (sans notation scientifique, zéros de fin supprimés) ; vide si manquant."""
    if x is None or not np.isfinite(x):
        return ""
    s = np.format_float_positional(round(float(x), dec), precision=dec, trim="-", unique=True)
    return "0" if s in ("-0", "") else s


def write_csv(df, name, decs=None):
    """Écrit un CSV ; decs = {colonne: décimales} (ou entier pour toutes les colonnes flottantes)."""
    from pandas.api import types as T
    out = pd.DataFrame(index=df.index)
    for c in df.columns:
        s = df[c]
        if T.is_bool_dtype(s):
            out[c] = s.astype(int).astype(str)
        elif T.is_integer_dtype(s):
            out[c] = s.astype(str)
        elif T.is_float_dtype(s):
            d = decs.get(c, 3) if isinstance(decs, dict) else (decs if decs is not None else 3)
            out[c] = [fnum(v, d) for v in s.values]
        else:
            out[c] = [("" if (v is None or (isinstance(v, float) and np.isnan(v)) or v is pd.NA) else str(v)) for v in s.values]
    path = os.path.join(OUT, name)
    out.to_csv(path, index=False)
    log(f"{name}: {len(out)} lignes, {os.path.getsize(path) / 1024:.0f} Ko")
    return path


# ------------------------------------------------------------------ données
p = lib.build_panel(SRC)
p = p[(p.season >= 1974) & (p.season <= 2026)].copy()
log("panel", p.shape, "joueurs", p.player_id.nunique())

# écart-type du niveau (pour exprimer les tolérances) : joueurs-saisons >= 500 minutes (82 matchs), pondération par les minutes
SD = {}
for k in ORDER:
    col = "y_" + k
    r = p[(p.mp82 >= 500) & p[col].notna()]
    mu = np.average(r[col], weights=r.mp82)
    SD[k] = float(np.sqrt(np.average((r[col] - mu) ** 2, weights=r.mp82)))
log("SD", {k: round(v, 3) for k, v in SD.items()})

pairs = {k: lib.make_pairs(p, k) for k in ORDER}
pairs_n = {k: len(v) for k, v in pairs.items()}
log("paires", pairs_n)


def select_pairs(pr, s0, s1, thr, pos):
    m = (pr.season0 >= s0) & (pr.season0 + 1 <= s1) & (pr.mp820 >= thr) & (pr.mp821 >= thr)
    if pos != "all":
        m &= pr.pos_grp == pos
    return pr[m]


def naive_curve(key, s0, s1, thr, pos):
    """Niveau moyen observé par âge (coupe transversale), pondéré par les minutes : biaisé par la survie."""
    col = "y_" + key
    m = (p.season >= s0) & (p.season <= s1) & (p.mp82 >= thr) & p[col].notna() & p.age.notna()
    if pos != "all":
        m &= p.pos_grp == pos
    r = p[m]
    g = r.assign(a=r.age.astype(int), wy=r[col] * r.mp82).groupby("a").agg(wy=("wy", "sum"), w=("mp82", "sum"), n=(col, "size"))
    g["mean"] = g.wy / g.w
    return g


def window_bounds(G, ac, tol):
    R, M = G.shape
    lo = np.empty(R); hi = np.empty(R); lc = np.zeros(R, bool); hc = np.zeros(R, bool)
    k = G.argmax(1)
    for r in range(R):
        g = G[r]; kk = k[r]
        j = kk
        while j > 0 and g[j - 1] >= -tol:
            j -= 1
        if j == 0:
            lo[r] = ac[0]; lc[r] = True
        else:
            g0, g1 = g[j - 1], g[j]
            lo[r] = ac[j - 1] + (-tol - g0) / (g1 - g0) * (ac[j] - ac[j - 1])
        j = kk
        while j < M - 1 and g[j + 1] >= -tol:
            j += 1
        if j == M - 1:
            hi[r] = ac[-1]; hc[r] = True
        else:
            g0, g1 = g[j], g[j + 1]
            hi[r] = ac[j] + (g0 + tol) / (g0 - g1) * (ac[j + 1] - ac[j])
    return lo, hi, lc, hc


def sig_ages(d_lo, d_hi, ages_src, peak):
    """Dernier âge atteint avec une progression nette ; premier âge de départ d'une baisse nette (bandes 5-95 %)."""
    up = np.nan; dn = np.nan
    ups = [a + 1 for a, v in zip(ages_src, d_lo) if v > 0 and a + 1 <= peak + 1e-9]
    if ups:
        up = float(max(ups))
    dns = [a for a, v in zip(ages_src, d_hi) if v < 0 and a >= np.floor(peak)]
    if dns:
        dn = float(min(dns))
    return up, dn


# ------------------------------------------------------------------ grille de courbes
rows_pics, rows_cour, rows_fen = [], [], []
t_last = time.time()
for key in ORDER:
    pr = pairs[key]
    for pos in POS:
        for era, (s0, s1) in ERAS.items():
            for thr in THR:
                sub = select_pairs(pr, s0, s1, thr, pos)
                seed = zlib.crc32(f"{key}|{pos}|{era}|{thr}".encode()) % (2 ** 31)
                res = lib.fit_combo(sub, AGES, h=H, nmin=NMIN, B=B, seed=seed)
                if res is None:
                    continue
                r3 = lib.fit_combo(sub, AGES, h=3.0, nmin=NMIN, B=0, seed=seed)
                r6 = lib.fit_combo(sub, AGES, h=6.0, nmin=NMIN, B=0, seed=seed)
                ac = res["ages_curve"].astype(float)
                src = res["ages_src"]
                bp = res["boot_peak"]
                gq = np.percentile(res["boot_G"], [5, 95], axis=0)
                dq = np.percentile(res["boot_ds"], [5, 95], axis=0)
                sd = SD[key]
                rows_pics.append(dict(
                    metric=key, pos=pos, era=era, thr=thr, n_pairs=res["n_pairs_total"], n_players=res["n_players_total"],
                    age_min=int(ac[0]), age_max=int(ac[-1]), peak=res["peak"],
                    peak_lo=float(np.percentile(bp, 5)), peak_hi=float(np.percentile(bp, 95)),
                    edge=bool(res["edge"]), edge_share=float(res["boot_edge"].mean()),
                    peak_h3=(r3["peak"] if r3 else np.nan), peak_h6=(r6["peak"] if r6 else np.nan)))
                nv = naive_curve(key, s0, s1, thr, pos)
                nmean = np.array([nv["mean"].get(int(a), np.nan) for a in ac])
                nn = np.array([nv["n"].get(int(a), 0) for a in ac])
                ng = nmean - np.nanmax(nmean) if np.isfinite(nmean).any() else nmean
                for i, a in enumerate(ac):
                    last = i == len(ac) - 1
                    rows_cour.append(dict(
                        metric=key, pos=pos, era=era, thr=thr, age=int(a),
                        n_pairs=(np.nan if last else res["n_pairs"][i]), n_players=(np.nan if last else res["n_players"][i]),
                        g=res["G"][i], g_lo=gq[0][i], g_hi=gq[1][i],
                        d_raw=(np.nan if last else res["raw_delta"][i]), d_s=(np.nan if last else res["delta_s"][i]),
                        d_lo=(np.nan if last else dq[0][i]), d_hi=(np.nan if last else dq[1][i]),
                        naive_g=ng[i], naive_n=nn[i]))
                allG = np.vstack([res["G"][None, :], res["boot_G"]])
                for t in TOLS:
                    lo, hi, lc, hc = window_bounds(allG, ac, t / 100.0 * sd)
                    rows_fen.append(dict(
                        metric=key, pos=pos, era=era, thr=thr, tol=t,
                        lo=lo[0], hi=hi[0], lo_p5=np.percentile(lo[1:], 5), lo_p95=np.percentile(lo[1:], 95),
                        hi_p5=np.percentile(hi[1:], 5), hi_p95=np.percentile(hi[1:], 95),
                        lo_c=bool(lc[0]), hi_c=bool(hc[0])))
    log(f"grille {key} ok ({len(rows_pics)} combinaisons)")

pics = pd.DataFrame(rows_pics)
cour = pd.DataFrame(rows_cour)
fen = pd.DataFrame(rows_fen)
pics["sd"] = pics.metric.map(SD)

# --- écriture avec décimales propres à chaque indicateur
cour["_dec"] = cour.metric.map(DEC)
for c in ("g", "g_lo", "g_hi", "d_raw", "d_s", "d_lo", "d_hi", "naive_g"):
    cour[c] = [np.nan if not np.isfinite(v) else round(float(v), int(d)) for v, d in zip(cour[c], cour["_dec"])]
cour = cour.drop(columns="_dec")
for c in ("n_pairs", "n_players", "naive_n"):
    cour[c] = cour[c].astype("Int64").astype(object).where(cour[c].notna(), "")
write_csv(cour, "courbes.csv", 5)
pics_dec = {c: 2 for c in pics.columns}
pics_dec.update(edge_share=3, sd=5)
write_csv(pics, "pics.csv", pics_dec)
write_csv(fen, "fenetres.csv", 2)

# ------------------------------------------------------------------ robustesse (échantillon de référence)
rob_rows = []
VARIANTS = ["base", "h3", "h6", "poids_egaux", "fe", "depuis1952", "naif"]
pfull = lib.build_panel(SRC)
for key in ORDER:
    pr = pairs[key]
    sub = select_pairs(pr, 1974, 2026, 500, "all")
    seed = 12345
    for v in VARIANTS:
        peak = lo = hi = np.nan; n = 0
        if v == "base":
            r = lib.fit_combo(sub, AGES, h=H, nmin=NMIN, B=B, seed=seed)
            base_ac = r["ages_curve"].astype(int)
        elif v == "h3":
            r = lib.fit_combo(sub, AGES, h=3.0, nmin=NMIN, B=200, seed=seed)
        elif v == "h6":
            r = lib.fit_combo(sub, AGES, h=6.0, nmin=NMIN, B=200, seed=seed)
        elif v == "poids_egaux":
            r = lib.fit_combo(sub.assign(w=1.0), AGES, h=H, nmin=NMIN, B=200, seed=seed)
        elif v == "depuis1952":
            # indicateurs disponibles avant 1974 : tout l'historique (1952-2026) ; sinon variante sans objet
            first = {"ws48": 1952, "per": 1952, "ws82": 1952, "ts_rel": 1952, "mpg": 1952, "gp_share": 1952}.get(key)
            r = None
            if first:
                prf = lib.make_pairs(pfull, key)
                m = (prf.season0 >= 1952) & (prf.season0 + 1 <= 2026) & (prf.mp820 >= 500) & (prf.mp821 >= 500)
                r = lib.fit_combo(prf[m], AGES, h=H, nmin=NMIN, B=200, seed=seed)
        elif v == "fe":
            rr = p[(p.mp82 >= 500) & p["y_" + key].notna() & p.age.between(19, 37)]
            pk, boot, ag, fc = robust.fe_peak(rr.player_id.values, rr.age.values, rr["y_" + key].values, rr.mp82.values, B=200, seed=seed)
            rob_rows.append(dict(metric=key, variant=v, peak=pk, lo=np.nanpercentile(boot, 5), hi=np.nanpercentile(boot, 95), n=len(rr)))
            continue
        elif v == "naif":
            nv = naive_curve(key, 1974, 2026, 500, "all")
            nv = nv[nv.index.isin(base_ac)]
            rob_rows.append(dict(metric=key, variant=v, peak=float(nv["mean"].idxmax()), lo=np.nan, hi=np.nan, n=int(nv.n.sum())))
            continue
        if r is not None:
            bp = r["boot_peak"]
            rob_rows.append(dict(metric=key, variant=v, peak=r["peak"],
                                 lo=(np.percentile(bp, 5) if len(bp) else np.nan), hi=(np.percentile(bp, 95) if len(bp) else np.nan),
                                 n=r["n_pairs_total"]))
    log(f"robustesse {key}")
rob = pd.DataFrame(rob_rows)
write_csv(rob, "robustesse.csv", 2)

# ------------------------------------------------------------------ ancienneté vs âge (par époque)
p2 = p.copy()
p2["age"] = p2["experience"].astype(float)
anc_rows = []
AGES_E = np.arange(1, 26)
for key in ("bpm", "ws48", "per", "vorp82", "ws82"):
    for axe, panel, ages in (("age", p, AGES), ("exp", p2, AGES_E)):
        prx = lib.make_pairs(panel, key)
        for era, (s0, s1) in ERAS.items():
            sub = select_pairs(prx, s0, s1, 500, "all")
            seed = zlib.crc32(f"anc|{key}|{axe}|{era}".encode()) % (2 ** 31)
            r = lib.fit_combo(sub, ages, h=H, nmin=NMIN, B=200, seed=seed)
            if r is None:
                continue
            rk = p[(p.experience == 1) & (p.mp82 >= 500) & (p.season >= s0) & (p.season <= s1)]
            anc_rows.append(dict(metric=key, era=era, axe=axe, peak=r["peak"], lo=np.percentile(r["boot_peak"], 5), hi=np.percentile(r["boot_peak"], 95),
                                 n_pairs=r["n_pairs_total"], edge=bool(r["edge"]), rookie_age=float(rk.age.mean()), n_rookies=len(rk)))
anc = pd.DataFrame(anc_rows)
write_csv(anc, "anciennete.csv", 2)
log("ancienneté ok")

# ------------------------------------------------------------------ joueurs : pics individuels (meilleure fenêtre de 3 saisons consécutives)
car = pd.read_csv(os.path.join(SRC, "Player Career Info.csv"), low_memory=False)
car = car[["player_id", "from", "to"]].rename(columns={"from": "first_season", "to": "last_season"})
names = p.drop_duplicates("player_id").set_index("player_id")["player"]
span = p.groupby("player_id").season.agg(["min", "max"])
pl = p.copy()
pl["q"] = pl.mp82 >= 500


def best_window(s, a, y, w, win=3, weighted=True):
    n = len(s)
    if n < win:
        return None
    best = None
    for i in range(n - win + 1):
        if s[i + win - 1] - s[i] != win - 1:
            continue
        val = np.average(y[i:i + win], weights=w[i:i + win]) if weighted else float(np.mean(y[i:i + win]))
        if best is None or val > best[0]:
            best = (val, float(np.mean(a[i:i + win])), int(s[i + 1]))
    return best


ind_rows = []
for pid, g in pl.groupby("player_id", sort=False):
    g = g.sort_values("season")
    gq = g[g.q & g.age.notna()]
    rec = dict(player_id=pid, n_q=len(gq))
    for k in ORDER:
        col = "y_" + k
        gk = gq[gq[col].notna()]
        r = None
        if len(gk) >= 3:
            weighted = lib.METRICS[k]["centered"]
            r = best_window(gk.season.values, gk.age.values, gk[col].values, gk.mp82.values, 3, weighted)
        rec[f"pk_{k}_age"] = r[1] if r else np.nan
        rec[f"pk_{k}_season"] = r[2] if r else np.nan
    ind_rows.append(rec)
ind = pd.DataFrame(ind_rows).merge(car, on="player_id", how="left")
ind["name"] = ind.player_id.map(names)
ind["first_season"] = ind.first_season.fillna(ind.player_id.map(span["min"]))
ind["last_season"] = ind.last_season.fillna(ind.player_id.map(span["max"]))
pos_of = p.drop_duplicates("player_id").set_index("player_id")["pos_grp"]
ind["pos"] = ind.player_id.map(pos_of)
vorp = p.groupby("player_id")["vorp"].sum()
ind["vorp_career"] = ind.player_id.map(vorp)
ind["retired"] = (ind.last_season <= 2023)
ind["first_season"] = ind.first_season.astype(int)
ind["last_season"] = ind.last_season.astype(int)
log("pics individuels:", len(ind), "joueurs")

# --- table des joueurs affichés dans l'explorateur : débuts >= 1974, au moins 5 saisons à >= 500 minutes
show = ind[(ind.first_season >= 1974) & (ind.n_q >= 5)].copy().sort_values("vorp_career", ascending=False)
show["rank_vorp"] = np.arange(1, len(show) + 1)
keep_cols = ["player_id", "name", "pos", "first_season", "last_season", "n_q", "retired", "vorp_career", "rank_vorp"] + \
            [f"pk_{k}_{t}" for k in ORDER for t in ("age", "season")]
jr = show[keep_cols].copy()
jr["pos"] = jr.pos.fillna("")
dec_jr = {c: (1 if c.endswith("_age") else 2) for c in jr.columns}
for c in jr.columns:
    if c.endswith("_season"):
        jr[c] = jr[c].astype("Int64").astype(object).where(jr[c].notna(), "")
write_csv(jr, "joueurs_resume.csv", dec_jr)

# --- saisons des joueurs affichés
cols_y = ["y_" + k for k in ORDER]
js = pl[pl.player_id.isin(show.player_id) & (pl.mp82 >= 250) & pl.age.notna()][["player_id", "season", "age", "mp82"] + cols_y].copy()
js["age"] = js.age.astype(int)
js["mp82"] = js.mp82.round().astype(int)
for k in ORDER:
    js["y_" + k] = [np.nan if not np.isfinite(v) else round(float(v), DEC[k] - (1 if k not in ("ws48",) else 0)) for v in js["y_" + k]]
js = js.rename(columns={"y_" + k: k for k in ORDER}).sort_values(["player_id", "season"])
write_csv(js, "joueurs.csv", 4)

# --- agrégats d'âges de pic individuels : carrières terminées, débuts >= 1974
COHORTS = {"all": (1974, 2026), "1974-1989": (1974, 1989), "1990-1999": (1990, 1999), "2000-2009": (2000, 2009), "2010-2019": (2010, 2019)}
MINLEN = [5, 7, 9, 11]
done = ind[(ind.first_season >= 1974) & ind.retired].copy()
res_rows, hist_rows = [], []
for key in ORDER:
    for pos in POS:
        for coh, (c0, c1) in COHORTS.items():
            for ml in MINLEN:
                s = done[(done.first_season >= c0) & (done.first_season <= c1) & (done.n_q >= ml)]
                if pos != "all":
                    s = s[s.pos == pos]
                v = s[f"pk_{key}_age"].dropna()
                if len(v) < 15:
                    continue
                res_rows.append(dict(metric=key, pos=pos, cohort=coh, minlen=ml, n=len(v), mean=v.mean(), median=v.median(),
                                     q25=v.quantile(.25), q75=v.quantile(.75), p10=v.quantile(.10), p90=v.quantile(.90)))
                bins = np.clip(np.round(v.values).astype(int), 19, 36)
                cnt = np.bincount(bins, minlength=40)
                for a in range(19, 37):
                    hist_rows.append(dict(metric=key, pos=pos, cohort=coh, minlen=ml, age=a, n=int(cnt[a]), share=cnt[a] / len(v)))
ires = pd.DataFrame(res_rows)
ihist = pd.DataFrame(hist_rows)
write_csv(ires, "indiv_resume.csv", 2)
write_csv(ihist, "indiv_hist.csv", 4)

# ------------------------------------------------------------------ structure par âge de la ligue
la_rows = []
for era, (s0, s1) in ERAS.items():
    r = p[(p.season >= s0) & (p.season <= s1) & p.age.notna() & (p.mp82 >= 250)]
    tot = r.mp82.sum()
    g = r.assign(a=r.age.astype(int)).groupby("a").agg(minutes=("mp82", "sum"), n=("mp82", "size"), players=("player_id", "nunique"))
    for a, row in g.iterrows():
        la_rows.append(dict(era=era, age=int(a), minutes_share=100 * row.minutes / tot, n_seasons=int(row.n), n_players=int(row.players)))
la = pd.DataFrame(la_rows)
write_csv(la, "ligue_age.csv", 3)

# ------------------------------------------------------------------ indicateurs, options, méthode
IND = [
    ("bpm", "BPM", "Impact global", "pts/100 poss.", 2, "Box Plus/Minus : contribution estimée du joueur à la marge de son équipe, en points pour 100 possessions, par rapport à la moyenne de la ligue.", "Écart à la moyenne de la ligue (pts/100 poss.)"),
    ("ws48", "Win Shares / 48 min", "Impact global", "victoires/48 min", 3, "Part de victoires attribuée au joueur par tranche de 48 minutes, écart à la moyenne de la ligue la même saison.", "Écart à la moyenne de la ligue"),
    ("per", "PER", "Impact global", "points de PER", 2, "Player Efficiency Rating : synthèse par minute des statistiques positives et négatives, écart à la moyenne de la ligue la même saison.", "Écart à la moyenne de la ligue"),
    ("vorp82", "VORP (82 matchs)", "Impact global", "VORP", 2, "Value Over Replacement Player : valeur apportée par rapport à un joueur de remplacement, ramenée à une saison de 82 matchs.", "Valeur par saison de 82 matchs"),
    ("ws82", "Win Shares (82 matchs)", "Impact global", "victoires", 2, "Nombre de victoires attribuées au joueur, ramené à une saison de 82 matchs.", "Valeur par saison de 82 matchs"),
    ("obpm", "BPM offensif", "Attaque", "pts/100 poss.", 2, "Composante offensive du Box Plus/Minus, écart à la moyenne de la ligue.", "Écart à la moyenne de la ligue (pts/100 poss.)"),
    ("ts_rel", "Adresse (TS %)", "Attaque", "pts de %", 2, "True Shooting % : efficacité au tir en tenant compte des trois points et des lancers francs, écart à la moyenne de la ligue.", "Écart à la moyenne de la ligue (points de pourcentage)"),
    ("usg", "Rôle offensif (USG %)", "Attaque", "pts de %", 2, "Part des possessions de l'équipe terminées par le joueur quand il est sur le terrain, écart à la moyenne de la ligue.", "Écart à la moyenne de la ligue (points de pourcentage)"),
    ("ast", "Passes (AST %)", "Attaque", "pts de %", 2, "Part des paniers de ses coéquipiers sur lesquels le joueur délivre la passe, écart à la moyenne de la ligue.", "Écart à la moyenne de la ligue (points de pourcentage)"),
    ("dbpm", "BPM défensif", "Défense et rebond", "pts/100 poss.", 2, "Composante défensive du Box Plus/Minus, écart à la moyenne de la ligue.", "Écart à la moyenne de la ligue (pts/100 poss.)"),
    ("trb", "Rebonds (TRB %)", "Défense et rebond", "pts de %", 2, "Part des rebonds disponibles captés par le joueur quand il est sur le terrain, écart à la moyenne de la ligue.", "Écart à la moyenne de la ligue (points de pourcentage)"),
    ("stl", "Interceptions (STL %)", "Défense et rebond", "pts de %", 2, "Part des possessions adverses se terminant par une interception du joueur, écart à la moyenne de la ligue.", "Écart à la moyenne de la ligue (points de pourcentage)"),
    ("blk", "Contres (BLK %)", "Défense et rebond", "pts de %", 2, "Part des tirs à deux points adverses contrés par le joueur, écart à la moyenne de la ligue.", "Écart à la moyenne de la ligue (points de pourcentage)"),
    ("mpg", "Minutes par match", "Disponibilité", "min/match", 1, "Temps de jeu moyen par match disputé, signe de la confiance de l'entraîneur.", "Minutes par match"),
    ("gp_share", "Matchs disputés (%)", "Disponibilité", "% des matchs", 1, "Part des matchs de son équipe disputés par le joueur dans la saison (blessures, repos, rotation).", "Part des matchs de l'équipe"),
]
ind_df = pd.DataFrame([dict(metric=k, label=l, famille=f, unite=u, dd=d, definition=de, axe=ax, sd=SD[k]) for k, l, f, u, d, de, ax in IND])
ind_df["ordre"] = np.arange(1, len(ind_df) + 1)
ind_df["pairs"] = ind_df.metric.map(pairs_n)
write_csv(ind_df, "indicateurs.csv", {"sd": 4})

opts = []
opts += [dict(filtre="pos", valeur="all", libelle="Tous les postes", ordre=1),
         dict(filtre="pos", valeur="G", libelle="Meneurs et arrières", ordre=2),
         dict(filtre="pos", valeur="F", libelle="Ailiers", ordre=3),
         dict(filtre="pos", valeur="C", libelle="Pivots", ordre=4)]
opts += [dict(filtre="era", valeur="all", libelle="Toutes les saisons", ordre=1)] + \
        [dict(filtre="era", valeur=e, libelle=e.replace("-", " à "), ordre=i + 2) for i, e in enumerate([e for e in ERAS if e != "all"])]
opts += [dict(filtre="thr", valeur="250", libelle="250 min ou plus", ordre=1),
         dict(filtre="thr", valeur="500", libelle="500 min ou plus", ordre=2),
         dict(filtre="thr", valeur="1000", libelle="1 000 min ou plus", ordre=3),
         dict(filtre="thr", valeur="1500", libelle="1 500 min ou plus", ordre=4)]
opts += [dict(filtre="tol", valeur="10", libelle="Stricte", ordre=1), dict(filtre="tol", valeur="20", libelle="Standard", ordre=2), dict(filtre="tol", valeur="30", libelle="Large", ordre=3)]
opts += [dict(filtre="minlen", valeur=str(m), libelle=f"{m} saisons ou plus", ordre=i + 1) for i, m in enumerate(MINLEN)]
opts += [dict(filtre="cohort", valeur="all", libelle="Tous les débuts", ordre=1)] + \
        [dict(filtre="cohort", valeur=e, libelle=e.replace("-", " à "), ordre=i + 2) for i, e in enumerate([e for e in COHORTS if e != "all"])]
write_csv(pd.DataFrame(opts), "options.csv")

qual = p[(p.mp82 >= 500)]
meth = [
    ("boot_B", B, "Rééchantillonnages par joueur"),
    ("ci_level", 90, "Niveau des intervalles (%)"),
    ("smooth_h", H, "Demi-largeur du lissage (années)"),
    ("thr_default", 500, "Seuil de minutes par défaut (ramenées à 82 matchs)"),
    ("first_season", 1974, "Première saison analysée"),
    ("last_season", 2026, "Dernière saison analysée"),
    ("games_ref", 82, "Matchs de référence"),
    ("n_min_pairs", NMIN, "Paires minimales par âge"),
    ("n_players_all", int(p.player_id.nunique()), "Joueurs dans l'analyse"),
    ("n_player_seasons", int(len(p)), "Joueurs-saisons dans l'analyse"),
    ("n_player_seasons_q", int(len(qual)), "Joueurs-saisons à 500 min ou plus"),
    ("n_pairs_bpm", int(pairs_n["bpm"]), "Paires de saisons consécutives (BPM)"),
    ("window_seasons", 3, "Saisons de la fenêtre du pic individuel"),
    ("indiv_min_default", 7, "Carrière minimale par défaut (saisons)"),
    ("tol_sd_step", 10, "Pas de tolérance (centièmes d'écart-type)"),
    ("n_indiv_done", int(len(done)), "Carrières terminées analysées"),
    ("n_indiv_shown", int(len(show)), "Joueurs de l'explorateur"),
    ("lag_retired", 2023, "Dernière saison d'une carrière terminée"),
    ("ref_age_1", 30, "Premier âge de repère (ans)"),
    ("ref_age_2", 34, "Second âge de repère (ans)"),
]
write_csv(pd.DataFrame(meth, columns=["cle", "valeur", "libelle"]), "methode.csv", 3)

json.dump({"SD": SD, "pairs_n": pairs_n}, open(os.path.join(OUT, "_meta.json"), "w"))
log("terminé")
