"""Vérification indépendante : recalcule des courbes d'âge directement depuis les fichiers bruts, sans lib.py,
puis compare aux CSV du tableau de bord.  Usage : python3 -I verify.py <données_brutes> <csv_dashboard>"""
import sys, os
import numpy as np
import pandas as pd

RAW, OUT = sys.argv[1], sys.argv[2]
adv = pd.read_csv(os.path.join(RAW, "Advanced.csv"), low_memory=False)
adv = adv[adv["lg"] == "NBA"].copy()
# une ligne par joueur-saison : celle qui a le plus de minutes (la ligne cumulée pour un joueur échangé)
adv = adv.sort_values(["player_id", "season", "mp"], ascending=[True, True, False]).drop_duplicates(["player_id", "season"])
tt = pd.read_csv(os.path.join(RAW, "Team Totals.csv"), low_memory=False)
tt = tt[(tt["lg"] == "NBA") & (tt["playoffs"] == False)]
tg = tt.groupby("season")["g"].median()
adv["tg"] = adv["season"].map(tg)
adv["k"] = 82.0 / adv["tg"]
adv["mp82"] = adv["mp"] * adv["k"]
adv = adv[(adv.season >= 1974) & (adv.season <= 2026)].copy()

def level(col, centered, scale=False):
    y = adv[col].astype(float)
    if scale:
        y = y * adv["k"]
    if centered:
        ok = y.notna() & (adv["mp"] >= 100)
        w = adv["mp"].where(ok, 0.0)
        mu = (y.fillna(0) * w).groupby(adv["season"]).sum() / w.groupby(adv["season"]).sum()
        y = y - adv["season"].map(mu)
    return y

def curve(metric, col, centered, scale=False, thr=500, h=4.5, nmin=30):
    adv["y"] = level(col, centered, scale)
    a = adv.dropna(subset=["y", "age"])[["player_id", "season", "age", "mp82", "y"]]
    nxt = a.copy(); nxt["season"] -= 1
    m = a.merge(nxt, on=["player_id", "season"], suffixes=("0", "1"))
    m = m[(m.age1 - m.age0 == 1) & (m.mp820 >= thr) & (m.mp821 >= thr)].copy()
    m["w"] = 2 * m.mp820 * m.mp821 / (m.mp820 + m.mp821)
    m["d"] = m.y1 - m.y0
    m["age0"] = m.age0.astype(int)
    g = m.groupby("age0")
    n = g.size()
    sw = g["w"].sum(); sw2 = g["w"].apply(lambda s: (s ** 2).sum()); swd = (m.w * m.d).groupby(m.age0).sum()
    ages = np.arange(18, 44)
    n = n.reindex(ages, fill_value=0)
    # support : plage contiguë autour du mode avec au moins nmin paires
    i0 = int(np.argmax(n.values)); lo = hi = i0
    while lo > 0 and n.values[lo - 1] >= nmin: lo -= 1
    while hi < len(ages) - 1 and n.values[hi + 1] >= nmin: hi += 1
    sup = ages[lo:hi + 1]
    raw = (swd / sw).reindex(sup).values
    neff = (sw ** 2 / sw2).reindex(sup).values
    ds = np.empty(len(sup))
    for i, a0 in enumerate(sup):
        u = np.abs(sup - a0) / h
        K = np.where(u < 1, (1 - u ** 3) ** 3, 0.0)
        w = K * neff; dx = sup - a0
        S0, S1, S2 = w.sum(), (w * dx).sum(), (w * dx * dx).sum()
        T0, T1 = (w * raw).sum(), (w * dx * raw).sum()
        den = S0 * S2 - S1 ** 2
        ds[i] = (S2 * T0 - S1 * T1) / den if den > 1e-9 * max(S0, 1e-12) ** 2 else T0 / S0
    L = np.concatenate([[0], np.cumsum(ds)])
    acurve = np.concatenate([sup, [sup[-1] + 1]]).astype(float)
    G = L - L.max()
    k = int(np.argmax(L)); peak = acurve[k]
    if 0 < k < len(ds):
        dp, dn = ds[k - 1], ds[k]
        if dp - dn > 1e-12: peak = acurve[k] - 0.5 + dp / (dp - dn)
    return dict(m=m, n=n.reindex(sup).values, raw=raw, ds=ds, G=G, acurve=acurve, peak=peak, sup=sup)

cour = pd.read_csv(os.path.join(OUT, "courbes.csv"))
pics = pd.read_csv(os.path.join(OUT, "pics.csv"))
ok_all = True
for metric, col, centered, scale in [("bpm", "bpm", True, False), ("per", "per", True, False), ("vorp82", "vorp", False, True), ("ws48", "ws_48", True, False)]:
    r = curve(metric, col, centered, scale)
    c = cour[(cour.metric == metric) & (cour.pos == "all") & (cour.era == "all") & (cour.thr == 500)].sort_values("age")
    pr = pics[(pics.metric == metric) & (pics.pos == "all") & (pics.era == "all") & (pics.thr == 500)].iloc[0]
    # d_raw / d_s sont définis pour les âges de départ ; g pour la courbe (un âge de plus)
    cs = c.set_index("age")
    d_n = np.abs(cs.loc[r["sup"], "n_pairs"].values - r["n"]).max()
    in_sup = r["m"][r["m"].age0.isin(r["sup"])]
    d_raw = np.abs(cs.loc[r["sup"], "d_raw"].values - r["raw"]).max()
    d_s = np.abs(cs.loc[r["sup"], "d_s"].values - r["ds"][:len(r["sup"])]).max()
    d_g = np.abs(cs.loc[r["acurve"].astype(int)[:len(cs)], "g"].values - r["G"][:len(cs)]).max() if len(cs) <= len(r["G"]) else np.nan
    print(f"{metric:7s} paires(support)={len(in_sup):6d} (csv {int(pr.n_pairs)}) joueurs={in_sup.player_id.nunique():5d} (csv {int(pr.n_players)}) [hors support : {len(r['m']) - len(in_sup)} paires] "
          f"| max|Δ n|={d_n:g}  max|Δ d_raw|={d_raw:.4g}  max|Δ d_s|={d_s:.4g}  max|Δ g|={d_g:.4g} | pic {r['peak']:.3f} (csv {pr.peak})")
    ok = (len(in_sup) == int(pr.n_pairs)) and in_sup.player_id.nunique() == int(pr.n_players) and d_n == 0 and d_raw < 2e-3 and d_s < 2e-3 and d_g < 2e-3 and abs(r['peak'] - pr.peak) < 0.011
    ok_all &= bool(ok)
    print("   ->", "OK" if ok else "ÉCART")

# --- contrôle ponctuel : LeBron James, valeurs brutes vs table « joueurs »
jr = pd.read_csv(os.path.join(OUT, "joueurs.csv"))
lj = jr[jr.player_id == "jamesle01"].set_index("season")
adv["ybpm"] = level("bpm", True)
a = adv[adv.player_id == "jamesle01"].set_index("season")
dif = (a.loc[lj.index, "ybpm"] - lj.bpm).abs().max()
dif_age = (a.loc[lj.index, "age"] - lj.age).abs().max()
dif_mp = (a.loc[lj.index, "mp82"] - lj.mp82).abs().max()
print(f"LeBron James : {len(lj)} saisons ; max|Δ BPM centré|={dif:.4g} ; max|Δ âge|={dif_age:g} ; max|Δ minutes|={dif_mp:.3g}")
print("   brut 2008-09 :", a.loc[2009, ["age", "mp", "bpm", "per", "ws_48"]].to_dict())
ok_all &= dif < 6e-3 and dif_age == 0 and dif_mp < 0.6
print("RÉSULTAT GLOBAL :", "OK" if ok_all else "ÉCART DÉTECTÉ")

# --- intervalle du pic (BPM) : bootstrap par joueurs réimplémenté, 400 tirages, comparé à pics.csv (300 tirages, autre graine)
r = curve("bpm", "bpm", True)
m = r["m"][r["m"].age0.isin(r["sup"])]
sup = r["sup"]
pids, pidx = np.unique(m.player_id.values, return_inverse=True)
P, A = len(pids), len(sup)
aidx = (m.age0.values - sup[0]).astype(int)
W1 = np.zeros((P, A)); W2 = np.zeros((P, A)); D1 = np.zeros((P, A))
np.add.at(W1, (pidx, aidx), m.w.values); np.add.at(W2, (pidx, aidx), m.w.values ** 2); np.add.at(D1, (pidx, aidx), (m.w * m.d).values)
rng = np.random.default_rng(12345)
peaks = []
for b in range(400):
    cnt = rng.multinomial(P, np.full(P, 1.0 / P)).astype(float)
    w1, w2, d1 = cnt @ W1, cnt @ W2, cnt @ D1
    raw = d1 / w1; neff = w1 ** 2 / w2
    ds = np.empty(A)
    for i, a0 in enumerate(sup):
        u = np.abs(sup - a0) / 4.5
        K = np.where(u < 1, (1 - u ** 3) ** 3, 0.0); w = K * neff; dx = sup - a0
        S0, S1, S2 = w.sum(), (w * dx).sum(), (w * dx * dx).sum(); T0, T1 = (w * raw).sum(), (w * dx * raw).sum()
        den = S0 * S2 - S1 ** 2
        ds[i] = (S2 * T0 - S1 * T1) / den if den > 1e-9 * max(S0, 1e-12) ** 2 else T0 / S0
    L = np.concatenate([[0], np.cumsum(ds)]); ac = np.concatenate([sup, [sup[-1] + 1]]).astype(float)
    k = int(np.argmax(L)); pk = ac[k]
    if 0 < k < A:
        dp, dn = ds[k - 1], ds[k]
        if dp - dn > 1e-12: pk = ac[k] - 0.5 + dp / (dp - dn)
    peaks.append(pk)
lo, hi = np.percentile(peaks, [5, 95])
pr = pics[(pics.metric == "bpm") & (pics.pos == "all") & (pics.era == "all") & (pics.thr == 500)].iloc[0]
print(f"Intervalle du pic BPM (90 %) : recalculé [{lo:.2f} ; {hi:.2f}] vs CSV [{pr.peak_lo} ; {pr.peak_hi}]")
