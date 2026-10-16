"""Bibliothèque de calcul des courbes d'âge NBA (méthode des différences entre saisons consécutives)."""
import os
import numpy as np
import pandas as pd

TOT = {"2TM", "3TM", "4TM", "5TM", "TOT"}
POS_GROUP = {"PG": "G", "SG": "G", "SF": "F", "PF": "F", "C": "C"}

# clé -> (colonne source, colonne finale, centrée par saison ?, première saison disponible)
METRICS = {
    "bpm":      dict(src="bpm",          centered=True,  since=1974),
    "ws48":     dict(src="ws_48",        centered=True,  since=1952),
    "per":      dict(src="per",          centered=True,  since=1952),
    "vorp82":   dict(src="vorp82",       centered=False, since=1974),
    "ws82":     dict(src="ws82",         centered=False, since=1952),
    "ts_rel":   dict(src="ts_pts",       centered=True,  since=1952),
    "usg":      dict(src="usg_percent",  centered=True,  since=1974),
    "ast":      dict(src="ast_percent",  centered=True,  since=1974),
    "obpm":     dict(src="obpm",         centered=True,  since=1974),
    "trb":      dict(src="trb_percent",  centered=True,  since=1974),
    "stl":      dict(src="stl_percent",  centered=True,  since=1974),
    "blk":      dict(src="blk_percent",  centered=True,  since=1974),
    "dbpm":     dict(src="dbpm",         centered=True,  since=1974),
    "mpg":      dict(src="mpg",          centered=False, since=1952),
    "gp_share": dict(src="gp_share",     centered=False, since=1952),
}


def _dedupe(df):
    """Une seule ligne par joueur-saison : la ligne agrégée (2TM, 3TM...) pour les joueurs échangés."""
    df = df.copy()
    df["_tot"] = df["team"].isin(TOT)
    df = df.sort_values(["player_id", "season", "_tot"], ascending=[True, True, False])
    return df.drop_duplicates(["player_id", "season"]).drop(columns="_tot")


def _center(p, col, wcol="mp", min_w=100):
    """Écart à la moyenne de la ligue la même saison (moyenne pondérée par les minutes)."""
    ok = p[col].notna() & (p[wcol] >= min_w)
    w = p[wcol].where(ok, 0.0)
    num = (p[col].fillna(0.0) * w).groupby(p["season"]).transform("sum")
    den = w.groupby(p["season"]).transform("sum")
    mean = num / den.replace(0, np.nan)
    return p[col] - mean


def build_panel(d):
    adv = pd.read_csv(os.path.join(d, "Advanced.csv"), low_memory=False)
    adv = _dedupe(adv[adv["lg"] == "NBA"])
    si = pd.read_csv(os.path.join(d, "Player Season Info.csv"), low_memory=False)
    si = _dedupe(si[si["lg"] == "NBA"])[["player_id", "season", "experience"]]
    car = pd.read_csv(os.path.join(d, "Player Career Info.csv"), low_memory=False)
    car = car[["player_id", "birth_date", "ht_in_in", "from", "to"]].rename(columns={"from": "first_season", "to": "last_season"})
    tt = pd.read_csv(os.path.join(d, "Team Totals.csv"), low_memory=False)
    tt = tt[(tt["lg"] == "NBA") & (tt["playoffs"] == False)]
    tg = tt.groupby("season")["g"].median().rename("tg").reset_index()

    p = adv.merge(si, on=["player_id", "season"], how="left").merge(car, on="player_id", how="left").merge(tg, on="season", how="left")
    p["age"] = p["age"].astype(float)
    p["k82"] = 82.0 / p["tg"]
    p["mp82"] = p["mp"] * p["k82"]
    p["mpg"] = p["mp"] / p["g"].replace(0, np.nan)
    p["gp_share"] = np.minimum(1.0, p["g"] / p["tg"]) * 100.0
    p["vorp82"] = p["vorp"] * p["k82"]
    p["ws82"] = p["ws"] * p["k82"]
    p["ts_pts"] = p["ts_percent"] * 100.0

    # position du joueur : position (parmi les cinq) la plus jouée, en minutes, sur sa carrière
    pm = p.dropna(subset=["pos"]).groupby(["player_id", "pos"])["mp"].sum().reset_index()
    pm = pm.sort_values(["player_id", "mp"], ascending=[True, False]).drop_duplicates("player_id")
    pm["pos_grp"] = pm["pos"].map(POS_GROUP)
    p = p.merge(pm[["player_id", "pos_grp"]], on="player_id", how="left")

    for key, m in METRICS.items():
        col = m["src"]
        p["y_" + key] = _center(p, col) if m["centered"] else p[col]
    return p.sort_values(["player_id", "season"]).reset_index(drop=True)


def make_pairs(p, key):
    """Paires de saisons consécutives d'un même joueur, âge n -> n+1."""
    y = "y_" + key
    a = p[["player_id", "season", "age", "mp82", "pos_grp", y]].dropna(subset=[y, "age"]).rename(columns={y: "y"})
    b = a[["player_id", "season", "age", "mp82", "y"]].copy()
    b["season"] = b["season"] - 1
    m = a.merge(b, on=["player_id", "season"], suffixes=("0", "1")).rename(columns={"season": "season0"})
    m = m[(m["age1"] - m["age0"]) == 1].copy()
    m["age0"] = m["age0"].astype(int)
    m["w"] = 2.0 * m["mp820"] * m["mp821"] / (m["mp820"] + m["mp821"])
    m["d"] = m["y1"] - m["y0"]
    return m


def tricube(u):
    u = np.abs(u)
    return np.where(u < 1, (1 - u ** 3) ** 3, 0.0)


def smooth_local_linear(delta, neff, x, h):
    """Régression locale linéaire (noyau tricube) de delta sur l'âge ; delta, neff : (B, A)."""
    dx = x[None, :] - x[:, None]                    # (cible, source)
    K = tricube(dx / h)                              # (A, A)
    om = K[None, :, :] * neff[:, None, :]            # (B, A, A)
    y = np.nan_to_num(delta)[:, None, :]
    S0 = om.sum(2); S1 = (om * dx).sum(2); S2 = (om * dx ** 2).sum(2)
    T0 = (om * y).sum(2); T1 = (om * dx * y).sum(2)
    den = S0 * S2 - S1 ** 2
    with np.errstate(divide="ignore", invalid="ignore"):
        ll = (S2 * T0 - S1 * T1) / den
        wm = T0 / S0
    bad = ~np.isfinite(ll) | (den <= 1e-9 * np.maximum(S0, 1e-12) ** 2)
    out = np.where(bad, wm, ll)
    return out


def peak_from_smooth_delta(ds, ages_src):
    """ds (B, A) : variation annuelle lissée pour la transition âge -> âge+1.
    Retourne la courbe cumulée L (B, A+1), l'âge fractionnaire du pic (B,), et l'indicateur de bord."""
    B, A = ds.shape
    L = np.concatenate([np.zeros((B, 1)), np.cumsum(ds, axis=1)], axis=1)
    ages_curve = np.concatenate([ages_src, [ages_src[-1] + 1]]).astype(float)
    k = np.argmax(L, axis=1)
    peak = ages_curve[k].copy()
    edge = (k == 0) | (k == A)
    for b in range(B):
        kk = k[b]
        if 0 < kk < A:
            dprev, dnext = ds[b, kk - 1], ds[b, kk]
            if dprev - dnext > 1e-12:
                peak[b] = ages_curve[kk] - 0.5 + dprev / (dprev - dnext)
    return L, peak, edge


def combo_sums(sub, ages_src):
    """Sommes par joueur et par âge de départ : poids, poids², poids×delta, nombre de paires."""
    pids, pidx = np.unique(sub["player_id"].values, return_inverse=True)
    aidx = (sub["age0"].values - ages_src[0]).astype(int)
    P, A = len(pids), len(ages_src)
    W1 = np.zeros((P, A)); W2 = np.zeros((P, A)); D1 = np.zeros((P, A)); N = np.zeros((P, A))
    w = sub["w"].values; d = sub["d"].values
    np.add.at(W1, (pidx, aidx), w)
    np.add.at(W2, (pidx, aidx), w ** 2)
    np.add.at(D1, (pidx, aidx), w * d)
    np.add.at(N, (pidx, aidx), 1.0)
    return pids, W1, W2, D1, N


def support_range(n_pairs, ages_src, nmin):
    """Plus longue plage contiguë d'âges de départ avec au moins nmin paires, contenant le mode."""
    ok = n_pairs >= nmin
    if not ok.any():
        return None
    i0 = int(np.argmax(n_pairs))
    if not ok[i0]:
        return None
    lo = hi = i0
    while lo - 1 >= 0 and ok[lo - 1]:
        lo -= 1
    while hi + 1 < len(ok) and ok[hi + 1]:
        hi += 1
    return lo, hi


def fit_combo(sub, ages_all, h=4.5, nmin=30, B=300, seed=0, rng=None):
    """Estimation de la courbe d'âge (point + bootstrap par joueur) pour un sous-échantillon de paires."""
    if len(sub) < nmin:
        return None
    pids, W1, W2, D1, N = combo_sums(sub, ages_all)
    n_pairs = N.sum(0)
    rg = support_range(n_pairs, ages_all, nmin)
    if rg is None:
        return None
    lo, hi = rg
    if hi - lo < 5:
        return None
    sl = slice(lo, hi + 1)
    ages_src = ages_all[sl]
    P = len(pids)
    rng = rng or np.random.default_rng(seed)
    counts = np.vstack([np.ones((1, P)), rng.multinomial(P, np.full(P, 1.0 / P), size=B).astype(float)])
    w1 = counts @ W1[:, sl]; w2 = counts @ W2[:, sl]; d1 = counts @ D1[:, sl]
    with np.errstate(divide="ignore", invalid="ignore"):
        delta = np.where(w1 > 0, d1 / w1, np.nan)
        neff = np.where(w2 > 0, w1 ** 2 / w2, 0.0)
    ds = smooth_local_linear(delta, neff, ages_src.astype(float), h)
    L, peak, edge = peak_from_smooth_delta(ds, ages_src)
    G = L - L.max(axis=1, keepdims=True)
    return dict(
        ages_src=ages_src, n_pairs=n_pairs[sl], n_players=(N[:, sl] > 0).sum(0),
        n_pairs_total=int(n_pairs[sl].sum()), n_players_total=int((N[:, sl].sum(1) > 0).sum()),
        raw_delta=delta[0], delta_s=ds[0], neff=neff[0], L=L[0], G=G[0], peak=float(peak[0]), edge=bool(edge[0]),
        boot_peak=peak[1:], boot_edge=edge[1:], boot_G=G[1:], boot_L=L[1:], boot_ds=ds[1:], boot_raw=delta[1:],
        ages_curve=np.concatenate([ages_src, [ages_src[-1] + 1]]),
    )
