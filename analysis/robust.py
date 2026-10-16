"""Estimateur de contrôle : effets fixes joueur + polynôme d'âge (pondéré par les minutes)."""
import numpy as np

A0, ASCALE = 26.0, 6.0


def player_stats(rows_pid, rows_age, rows_y, rows_w, deg=4):
    """Statistiques suffisantes par joueur (matrice A_i, vecteur b_i) de la régression intra-joueur."""
    pids, pidx = np.unique(rows_pid, return_inverse=True)
    P = len(pids)
    a = (rows_age.astype(float) - A0) / ASCALE
    X = np.vstack([a ** k for k in range(1, deg + 1)]).T          # pas de constante : absorbée par l'effet joueur
    w = rows_w.astype(float)
    sw = np.bincount(pidx, weights=w, minlength=P)
    K = X.shape[1]
    sx = np.zeros((P, K)); sy = np.bincount(pidx, weights=w * rows_y, minlength=P)
    sxx = np.zeros((P, K, K)); sxy = np.zeros((P, K))
    for k in range(K):
        sx[:, k] = np.bincount(pidx, weights=w * X[:, k], minlength=P)
        sxy[:, k] = np.bincount(pidx, weights=w * X[:, k] * rows_y, minlength=P)
        for l in range(K):
            sxx[:, k, l] = np.bincount(pidx, weights=w * X[:, k] * X[:, l], minlength=P)
    with np.errstate(divide="ignore", invalid="ignore"):
        Ai = sxx - sx[:, :, None] * sx[:, None, :] / sw[:, None, None]
        bi = sxy - sx * sy[:, None] / sw[:, None]
    Ai = np.nan_to_num(Ai); bi = np.nan_to_num(bi)
    return Ai, bi


def poly_curve(beta, ages):
    a = (np.asarray(ages, float) - A0) / ASCALE
    return sum(beta[k] * a ** (k + 1) for k in range(len(beta)))


def fe_peak(rows_pid, rows_age, rows_y, rows_w, deg=4, B=200, seed=0, grid=(20.0, 36.0)):
    Ai, bi = player_stats(rows_pid, rows_age, rows_y, rows_w, deg)
    P = Ai.shape[0]
    rng = np.random.default_rng(seed)
    counts = np.vstack([np.ones((1, P)), rng.multinomial(P, np.full(P, 1.0 / P), size=B).astype(float)])
    ag = np.arange(grid[0], grid[1] + 1e-9, 0.05)
    peaks = []
    curves = []
    for c in counts:
        M = np.tensordot(c, Ai, axes=(0, 0)); v = c @ bi
        try:
            beta = np.linalg.solve(M + 1e-9 * np.eye(M.shape[0]), v)
        except np.linalg.LinAlgError:
            peaks.append(np.nan); continue
        f = poly_curve(beta, ag)
        peaks.append(ag[int(np.argmax(f))])
        curves.append(f - f.max())
    peaks = np.array(peaks)
    return float(peaks[0]), peaks[1:], ag, curves[0]
