"""
surrogate model: from the first 3 weeks of treatment, predict IF and WHEN resistant cells take over,
with uncertainty (prediction intervals that actually contain the true day as often as they claim)

two models:
  1. classifier -> chance of each outcome by day 180: takeover / not_by_180 / eradicated
  2. quantile regressors -> takeover day (only trained on runs where takeover happened). one model per quantile,
     then "conformalized" (CQR, Romano et al. 2019) on a separate calibration set so the intervals get the
     coverage they say they have, eg the 80% interval really contains the true day ~80% of the time

splits are by run id: 60% train / 20% calibration / 20% test and obviously we don't touch the test ones til the end
"""
import json, sys, os
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.metrics import log_loss, accuracy_score, mean_absolute_error

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
os.makedirs(OUT, exist_ok=True)

VOCAB = json.load(open(os.path.join(HERE, "vocab.json")))
CANCERS, REGIMENS, GROUPS = VOCAB["cancers"], VOCAB["regimens"], VOCAB["groups"]
REGIMEN_GROUPS = VOCAB["regimenGroups"]
OUTCOMES = ["takeover", "not_by_180", "eradicated"]
LEVELS = [0.5, 0.8, 0.9, 0.95]                         # interval coverages we check
qlo = lambda l: round((1 - l) / 2, 4)
qhi = lambda l: round(1 - (1 - l) / 2, 4)
QS = sorted({q for l in LEVELS for q in (qlo(l), qhi(l))} | {0.5})
EPS = 1e-6


#  features (same math is in surrogate.js - DO NOT LET THESE GET OUT OF SYNC) 
def trajectory_features(sizes):
    """sizes = living cells on days 0--21"""
    n0 = max(sizes[0], 1)
    rel = [s / n0 for s in sizes[:22]]
    nadir = min(rel)
    nadir_day = rel.index(nadir)
    r7, r14, r21 = rel[7], rel[14], rel[21]
    return {
        "logN0": float(np.log10(n0)), "r7": r7, "r14": r14, "r21": r21,
        "nadir": nadir, "nadir_day": nadir_day,
        "slope_14_21": float(np.log(max(r21, EPS) / max(r14, EPS)) / 7),
        "slope_7_14": float(np.log(max(r14, EPS) / max(r7, EPS)) / 7),
        "regrowing": int(r21 > nadir * 1.1),
    }


def featurize(row, oracle=False):
    f = {}
    for c in CANCERS: f["cancer_" + c] = int(row["cancer"] == c)
    for r in REGIMENS: f["regimen_" + r] = int(row["regimen"] == r)
    for g in GROUPS: f["uses_" + g] = int(g in REGIMEN_GROUPS[row["regimen"]])
    f["doseScale"] = row["doseScale"]
    f.update(trajectory_features(row["sizes"]))
    if oracle:
        f["true_res_frac_d21"] = row["true_res_frac_d21"]
        f["n_clones_d21"] = row["n_clones_d21"]
    return f


def load(path):
    rows = [json.loads(l) for l in open(path) if l.strip()]
    df = pd.DataFrame(rows).sort_values("runId").reset_index(drop=True)
    # split by run id so it's reproducible: 0-5 train, 6-7 calibration, 8-9 test
    df["split"] = np.where(df.runId % 10 < 6, "train", np.where(df.runId % 10 < 8, "cal", "test"))
    return df


def hgb_reg(q):
    return HistGradientBoostingRegressor(loss="quantile", quantile=q, max_iter=300, learning_rate=0.05,
                                         max_leaf_nodes=15, min_samples_leaf=10, l2_regularization=1.0, random_state=0)


def fit_quantiles(X, y):
    return {q: hgb_reg(q).fit(X, y) for q in QS}


def cqr_offsets(models, X, y):
    """how much to widen each interval so coverage is right on the cal set"""
    off = {}
    n = len(y)
    for l in LEVELS:
        lo, hi = models[qlo(l)].predict(X), models[qhi(l)].predict(X)
        scores = np.maximum(lo - y, y - hi)
        k = min(1.0, np.ceil((n + 1) * l) / n)
        off[l] = float(np.quantile(scores, k, method="higher"))
    return off


def intervals(models, off, X, level):
    lo = models[qlo(level)].predict(X) - off[level]
    hi = models[qhi(level)].predict(X) + off[level]
    return lo, hi
def main(path):
    df = load(path)
    print(f"{len(df)} runs: " + ", ".join(f"{k} {v}" for k, v in df.outcome.value_counts().items()))
    X = pd.DataFrame([featurize(r) for r in df.to_dict("records")])
    FEATS = list(X.columns)
    y_cls = df.outcome.map({o: i for i, o in enumerate(OUTCOMES)}).values
    tr, ca, te = [(df.split == s).values for s in ("train", "cal", "test")]
    metrics = {"n_runs": len(df), "outcome_counts": df.outcome.value_counts().to_dict(),
               "split_sizes": {"train": int(tr.sum()), "cal": int(ca.sum()), "test": int(te.sum())}}

    #  1. outcome classifier 
    clf = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.05, max_leaf_nodes=15, min_samples_leaf=10,
                                         l2_regularization=1.0, random_state=0)
    clf.fit(X[tr | ca], y_cls[tr | ca])  
    P = clf.predict_proba(X[te])
    # make sure columns are in OUTCOMES order even if a class is missing from training
    Pfull = np.zeros((te.sum(), 3)); Pfull[:, clf.classes_] = P
    prior = np.bincount(y_cls[tr | ca], minlength=3) / (tr | ca).sum()
    metrics["classifier"] = {
        "accuracy": accuracy_score(y_cls[te], Pfull.argmax(1)),
        "log_loss": log_loss(y_cls[te], np.clip(Pfull, 1e-6, 1), labels=[0, 1, 2]),
        "baseline_log_loss_class_frequencies": log_loss(y_cls[te], np.tile(prior, (te.sum(), 1)), labels=[0, 1, 2]),
        "brier_takeover": float(np.mean((Pfull[:, 0] - (y_cls[te] == 0)) ** 2)),
    }
    print("classifier:", json.dumps(metrics["classifier"], indent=1))

    #  2. takeover-day quantile regression (log days, so intervals are going to be wider for later takeovers) 
    tk = (df.outcome == "takeover").values
    ylog = np.log(df.T_res.where(tk, 1).astype(float).values)
    models = fit_quantiles(X[tr & tk], ylog[tr & tk])
    off = cqr_offsets(models, X[ca & tk], ylog[ca & tk])
    Xt, yt = X[te & tk], df.T_res[te & tk].astype(float).values
    med = np.exp(models[0.5].predict(Xt))
    cover_raw, cover_cqr, widths = {}, {}, {}
    for l in LEVELS:
        lo0, hi0 = models[qlo(l)].predict(Xt), models[qhi(l)].predict(Xt)
        cover_raw[l] = float(np.mean((np.log(yt) >= lo0) & (np.log(yt) <= hi0)))
        lo, hi = intervals(models, off, Xt, l)
        cover_cqr[l] = float(np.mean((np.log(yt) >= lo) & (np.log(yt) <= hi)))
        widths[l] = float(np.median(np.exp(hi) - np.exp(lo)))

    # baselines: (A) median takeover day per regimen, ignoring weeks 1-3 (the "no ML" guess from the spec)
    base_med = df[tr & tk].groupby("regimen").T_res.median()
    overall = df[tr & tk].T_res.median()
    base_pred = df[te & tk].regimen.map(base_med).fillna(overall).values
    # B) same model but with NO trajectory features (shows weeks 1-3 are what make it work)
    TREAT = [c for c in FEATS if c.startswith(("cancer_", "regimen_", "uses_")) or c == "doseScale"]
    m_treat = hgb_reg(0.5).fit(X[tr & tk][TREAT], ylog[tr & tk])
    # (c) "oracle" model that also sees the real resistant fraction on day 21 
    # (can't measure that in a patient so this one is cheating but it's still interesting to see)
    Xo = pd.DataFrame([featurize(r, oracle=True) for r in df.to_dict("records")])
    m_or = hgb_reg(0.5).fit(Xo[tr & tk], ylog[tr & tk])

    metrics["takeover_day"] = {
        "n_test": int(len(yt)),
        "MAE_days": mean_absolute_error(yt, med),
        "baseline_MAE_median_per_regimen": mean_absolute_error(yt, base_pred),
        "MAE_treatment_only_no_weeks_1_3": mean_absolute_error(yt, np.exp(m_treat.predict(Xt[TREAT]))),
        "MAE_oracle_with_true_resistant_fraction": mean_absolute_error(yt, np.exp(m_or.predict(Xo[te & tk]))),
        "coverage_before_conformal": cover_raw, "coverage_after_conformal": cover_cqr,
        "median_interval_width_days": widths, "cqr_offsets_log_days": off,
    }
    print("takeover day:", json.dumps(metrics["takeover_day"], indent=1))
    json.dump(metrics, open(os.path.join(OUT, "metrics.json"), "w"), indent=2)

    # save the trained models so plots.py can make every plot without retraining all over again and bogging everything down
    import joblib
    joblib.dump({"clf": clf, "models": models, "off": off, "feats": FEATS}, os.path.join(OUT, "models.joblib"))
    export(clf, models, off, FEATS)
    # a few test rows w/ python predictions so the JS port can be checked against them
    chk = []
    for i, row in enumerate(df[te].head(25).to_dict("records")):
        x = X[te].iloc[[i]]
        p = np.zeros(3); p[clf.classes_] = clf.predict_proba(x)[0]
        lo, hi = intervals(models, off, x, 0.8)
        chk.append({"row": {k: row[k] for k in ("cancer", "regimen", "doseScale", "sizes")},
                    "probs": p.tolist(), "p50": float(np.exp(models[0.5].predict(x))[0]),
                    "lo80": float(np.exp(lo)[0]), "hi80": float(np.exp(hi)[0])})
    json.dump(chk, open(os.path.join(OUT, "parity_check.json"), "w"))


#  export the trees to JSON for surrogate.js 
def sig(x, n=7):
    """round to n significant digits"""
    return float(f"{x:.{n}g}")


def trees_of(model, k=0):
    """compact tree format: f = feature index (-1 means leaf), t = threshold,
    l / r = child node indexes"""
    out = []
    for it in model._predictors:
        nodes = it[k].nodes
        leaf = nodes["is_leaf"].astype(bool)
        out.append({
            "f": np.where(leaf, -1, nodes["feature_idx"]).astype(int).tolist(),
            "t": [sig(float(v if lf else th)) for v, th, lf in zip(nodes["value"], nodes["num_threshold"], leaf)],
            "l": np.where(leaf, 0, nodes["left"]).astype(int).tolist(),
            "r": np.where(leaf, 0, nodes["right"]).astype(int).tolist(),
        })
    return out


def export(clf, models, off, feats):
    base = np.asarray(clf._baseline_prediction).ravel().tolist()
    model = {
        "format": 2, "trained": pd.Timestamp.now().isoformat(timespec="minutes"),
        "features": feats, "outcomes": OUTCOMES, "vocab": VOCAB,
        "classifier": {"classes": clf.classes_.tolist(), "baseline": base,
                       "trees": [trees_of(clf, k) for k in range(len(base))]},
        "quantiles": {str(q): {"baseline": float(np.asarray(m._baseline_prediction).ravel()[0]), "trees": trees_of(m)} for q, m in models.items()},
        "cqr_offsets": {str(k): v for k, v in off.items()},
        "levels": LEVELS,
    }
    json.dump(model, open(os.path.join(OUT, "surrogate_model.json"), "w"), separators=(",", ":"))
    print("wrote surrogate_model.json", os.path.getsize(os.path.join(OUT, "surrogate_model.json")) // 1024, "KB")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "runs.jsonl")
