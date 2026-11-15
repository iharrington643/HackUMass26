"""
plots.py - every plot for the surrogate model (run train.py first, it saves the models this loads)

    python3 surrogate/plots.py runs.jsonl

here's what we calculate below and which file you can see the output in: 
    1_calibration.png          do the prediction intervals + takeover chances mean what they say?
    2_predictions.png          predicted vs real takeover day on held-out runs, with 80% intervals
    3_resistance_over_time.png % of patients where resistance has taken over, by kind of treatment
    4_first_three_weeks.png    tumor size in weeks 1-3, colored by what happened later
    5_resistance_rise.png      resistant share climbing in a few example runs, takeover day marked
    6_feature_importance.png   which inputs the takeover-day model leans on most
    7_learning_curve.png       does more sim data help? (error vs number of training runs)
    8_confusion.png            outcome classifier: predicted vs real outcome
    9_takeover_by_regimen.png  takeover day for every run, per regimen

colors come from the dataviz palette (fixed order, colorblind-checked). outcomes always use the same colors
in every plot: takeover = blue, not by day 180 = orange, eradicated = aqua
"""
import os, sys, json
import numpy as np
import pandas as pd
import joblib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from sklearn.metrics import mean_absolute_error
from sklearn.inspection import permutation_importance

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from train import load, featurize, hgb_reg, fit_quantiles, cqr_offsets, intervals, OUTCOMES, LEVELS, REGIMEN_GROUPS, OUT

PLOTS = os.path.join(OUT, "plots")
os.makedirs(PLOTS, exist_ok=True)

SURFACE, INK, INK2, MUTED, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#8a8984", "#e6e5e1"
SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"]
OUTCOME_COLOR = dict(zip(OUTCOMES, SERIES))                    # takeover blue, not_by_180 orange, eradicated aqua
OUTCOME_LABEL = {"takeover": "resistance took over", "not_by_180": "no takeover by day 180", "eradicated": "tumor wiped out"}
GROUP_ORDER = ["chemo", "hormone", "adc", "immuno", "rt", "combo"]
GROUP_COLOR = dict(zip(GROUP_ORDER, SERIES))
GROUP_LABEL = {"chemo": "chemo", "hormone": "hormone (goserelin)", "adc": "Enhertu", "immuno": "pembrolizumab",
               "rt": "radiation", "combo": "mixed (2+ kinds)"}
BLUE_RAMP = ["#fcfcfb", "#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#104281"]

plt.rcParams.update({
    "figure.facecolor": SURFACE, "axes.facecolor": SURFACE, "savefig.facecolor": SURFACE,
    "font.size": 10, "axes.titlesize": 11, "axes.titleweight": "bold", "axes.titlelocation": "left",
    "axes.edgecolor": MUTED, "axes.labelcolor": INK2, "xtick.color": INK2, "ytick.color": INK2, "text.color": INK,
    "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.8,
    "axes.axisbelow": True, "lines.linewidth": 2, "legend.frameon": False, "legend.fontsize": 8.5,
})


def save(fig, name):
    fig.tight_layout()
    fig.savefig(os.path.join(PLOTS, name), dpi=160)
    plt.close(fig)
    print("  saved", name)


def group_of(regimen):
    g = REGIMEN_GROUPS[regimen]
    return g[0] if len(g) == 1 else "combo"


def setup(path):
    df = load(path)
    art = joblib.load(os.path.join(OUT, "models.joblib"))
    X = pd.DataFrame([featurize(r) for r in df.to_dict("records")])[art["feats"]]
    tr, ca, te = [(df.split == s).values for s in ("train", "cal", "test")]
    tk = (df.outcome == "takeover").values
    df["group"] = df.regimen.map(group_of)
    return df, X, art, tr, ca, te, tk


def plot_calibration(df, X, art, te, tk):
    models, off, clf = art["models"], art["off"], art["clf"]
    Xt, yt = X[te & tk], df.T_res[te & tk].astype(float).values
    raw, cqr = [], []
    for l in LEVELS:
        lo0, hi0 = intervals(models, {k: 0 for k in off}, Xt, l)
        raw.append(np.mean((np.log(yt) >= lo0) & (np.log(yt) <= hi0)))
        lo, hi = intervals(models, off, Xt, l)
        cqr.append(np.mean((np.log(yt) >= lo) & (np.log(yt) <= hi)))
    L = np.array(LEVELS)
    se = np.sqrt(L * (1 - L) / len(yt))

    fig, ax = plt.subplots(1, 2, figsize=(10.5, 4.6))
    a = ax[0]
    a.fill_between(L, L - 2 * se, L + 2 * se, color=GRID, lw=0, label="±2 SE (normal random wobble)")
    a.plot([0.45, 1], [0.45, 1], color=MUTED, ls="--", lw=1, label="perfect")
    a.plot(L, raw, "o-", color=SERIES[1], ms=7, label="quantile model alone")
    a.plot(L, cqr, "o-", color=SERIES[0], ms=7, label="after conformal calibration")
    a.annotate("too narrow", (L[1], raw[1]), xytext=(8, -4), textcoords="offset points", color=INK2, fontsize=8.5)
    a.set(xlabel="coverage the interval claims", ylabel="coverage on held-out runs", xlim=(0.45, 1), ylim=(0.15, 1.02),
          title=f"Takeover-day intervals (n={len(yt)} test runs)")
    a.legend(loc="upper left")

    P = np.zeros((te.sum(), 3)); P[:, clf.classes_] = clf.predict_proba(X[te])
    p, y = P[:, 0], (df.outcome[te] == "takeover").values.astype(float)
    bins = np.linspace(0, 1, 6); idx = np.clip(np.digitize(p, bins) - 1, 0, 4)
    xs, ys, ns = [], [], []
    for b in range(5):
        m = idx == b
        if m.sum() >= 5: xs.append(p[m].mean()); ys.append(y[m].mean()); ns.append(int(m.sum()))
    a = ax[1]
    a.plot([0, 1], [0, 1], color=MUTED, ls="--", lw=1)
    a.plot(xs, ys, color=SERIES[0])
    a.scatter(xs, ys, s=[30 + 1.5 * n for n in ns], color=SERIES[0], edgecolor=SURFACE, linewidth=2, zorder=3)
    for x_, y_, n in zip(xs, ys, ns):
        a.annotate(f"{n} runs", (x_, y_), xytext=(9, -12) if y_ > 0.1 else (12, 6), textcoords="offset points", fontsize=8, color=INK2)
    brier = np.mean((p - y) ** 2)
    a.set(xlabel="predicted chance of takeover by day 180", ylabel="share that actually took over",
          xlim=(-0.03, 1.03), ylim=(-0.03, 1.03), title=f"Takeover probability (Brier {brier:.3f})")
    save(fig, "1_calibration.png")


def plot_predictions(df, X, art, te, tk):
    models, off = art["models"], art["off"]
    Xt, yt = X[te & tk], df.T_res[te & tk].astype(float).values
    med = np.exp(models[0.5].predict(Xt))
    lo, hi = intervals(models, off, Xt, 0.8)
    lo, hi = np.exp(lo), np.minimum(np.exp(hi), 180)
    inside = (yt >= lo) & (yt <= hi)
    fig, a = plt.subplots(figsize=(5.6, 5.4))
    a.vlines(med, lo, hi, color="#9ec5f4", lw=1.5, label="80% interval")
    a.scatter(med[inside], yt[inside], s=22, color=SERIES[0], edgecolor=SURFACE, linewidth=1, zorder=3, label=f"real day, inside ({inside.sum()})")
    a.scatter(med[~inside], yt[~inside], s=34, color=SERIES[7], marker="X", edgecolor=SURFACE, linewidth=0.8, zorder=3, label=f"real day, outside ({(~inside).sum()})")
    a.plot([0, 185], [0, 185], color=MUTED, ls="--", lw=1)
    a.set(xlim=(0, 185), ylim=(0, 185), xlabel="predicted takeover day (median)", ylabel="real takeover day",
          title=f"Held-out runs: off by {mean_absolute_error(yt, med):.1f} days on average")
    a.legend(loc="upper left")
    save(fig, "2_predictions.png")


def plot_resistance_over_time(df):
    days = np.arange(0, 181)
    fig, a = plt.subplots(figsize=(8, 4.8))
    ends = []
    for g in GROUP_ORDER:
        sub = df[df.group == g]
        if len(sub) < 10: continue
        t = sub.T_res.where(sub.outcome == "takeover", np.inf).astype(float).values
        cum = np.array([(t <= d).mean() for d in days]) * 100  
        a.step(days, cum, where="post", color=GROUP_COLOR[g], label=f"{GROUP_LABEL[g]} ({len(sub)} runs)")
        ends.append((cum[-1], g))
    ends.sort(); last = -99
    for v, g in ends:
        y = max(v, last + 4.5); last = y
        a.text(182, y, GROUP_LABEL[g], color=INK2, fontsize=8.5, va="center")
    a.set(xlim=(0, 180), ylim=(0, max(v for v, _ in ends) + 8), xlabel="days since treatment started",
          ylabel="% of runs where resistance took over", title="How fast resistance takes over, by kind of treatment")
    a.legend(loc="upper left")
    fig.subplots_adjust(right=0.8)
    save(fig, "3_resistance_over_time.png")


def plot_first_three_weeks(df):
    fig, ax = plt.subplots(1, 3, figsize=(12, 4.2), sharey=True)
    rng = np.random.default_rng(0)
    for a, o in zip(ax, OUTCOMES):
        sub = df[df.outcome == o]
        rel = np.array([np.array(s[:22]) / max(s[0], 1) for s in sub.sizes])
        rel = np.clip(rel, 1e-3, None)
        for k in rng.choice(len(rel), size=min(60, len(rel)), replace=False):
            a.plot(range(22), rel[k], color=OUTCOME_COLOR[o], alpha=0.18, lw=1)
        a.plot(range(22), np.median(rel, axis=0), color=OUTCOME_COLOR[o], lw=2.5, label="median")
        a.axhline(1, color=MUTED, lw=1, ls="--")
        a.set(yscale="log", xlabel="day of treatment", title=f"{OUTCOME_LABEL[o]} ({len(sub)} runs)", xticks=[0, 7, 14, 21])
        a.legend(loc="lower left")
    ax[0].set_ylabel("tumor size vs day 0 (log scale)")
    fig.suptitle("Weeks 1–3 already look different depending on what happens later", x=0.01, ha="left", fontweight="bold", fontsize=12)
    save(fig, "4_first_three_weeks.png")


def plot_resistance_rise(df):
    tk = df[df.outcome == "takeover"].sort_values("T_res")
    picks = tk.iloc[np.linspace(0, len(tk) - 1, 6).astype(int)]
    fig, a = plt.subplots(figsize=(8.5, 5.6))
    a.axhline(50, color=MUTED, lw=1, ls="--")
    a.text(24, 51.5, "takeover line (50%)", ha="left", va="bottom", color=INK2, fontsize=8.5)
    for k, (_, r) in enumerate(picks.iterrows()):
        f = np.array(r.resFrac) * 100
        c = SERIES[k]
        a.plot(range(len(f)), f, color=c, label=f"{r.cancer}, {r.regimen} (day {int(r.T_res)})")
        a.scatter([r.T_res], [f[int(r.T_res)]], s=60, color=c, edgecolor=SURFACE, linewidth=2, zorder=4)
    a.set(xlim=(0, 180), ylim=(-2, 102), xlabel="days since treatment started", ylabel="% of living cells that are resistant",
          title="Resistant cells taking over in 6 example runs (dot = takeover day)")
    a.legend(loc="upper left", bbox_to_anchor=(0, -0.14), ncol=2, fontsize=8)
    save(fig, "5_resistance_rise.png")


NICE = {"r21": "size on day 21", "r14": "size on day 14", "r7": "size on day 7", "nadir": "smallest size", "nadir_day": "day of smallest size",
        "slope_14_21": "growth rate, week 3", "slope_7_14": "growth rate, week 2", "regrowing": "growing back by day 21",
        "logN0": "starting size", "doseScale": "dose"}

def nice(f):
    if f in NICE: return NICE[f]
    for p, w in (("cancer_", "cancer: "), ("regimen_", "regimen: "), ("uses_", "uses ")):
        if f.startswith(p): return w + f[len(p):]
    return f

def plot_importance(df, X, art, te, tk):
    m = art["models"][0.5]
    Xt, y = X[te & tk], np.log(df.T_res[te & tk].astype(float).values)
    r = permutation_importance(m, Xt, y, n_repeats=20, random_state=0, scoring="neg_mean_absolute_error")
    # convert from log-days error to "how many % worse the error gets"
    base = mean_absolute_error(y, m.predict(Xt))
    imp = pd.Series(r.importances_mean / base * 100, index=X.columns).sort_values().tail(12)
    sd = pd.Series(r.importances_std / base * 100, index=X.columns)[imp.index]
    fig, a = plt.subplots(figsize=(7.5, 4.8))
    traj = [k in NICE and k not in ("doseScale",) for k in imp.index]
    cols = [SERIES[0] if t else SERIES[1] for t in traj]
    a.barh(range(len(imp)), imp.values, color=cols, height=0.6, xerr=sd.values, error_kw={"ecolor": MUTED, "lw": 1, "capsize": 0})
    a.set_yticks(range(len(imp)), [nice(k) for k in imp.index])
    a.grid(axis="y", visible=False)
    for k, v in enumerate(imp.values): a.text(v + sd.values[k] + 2, k, f"+{v:.0f}%", va="center", fontsize=8, color=INK2)
    a.legend(handles=[Line2D([], [], color=SERIES[0], lw=6, label="tumor size, weeks 1–3"),
                      Line2D([], [], color=SERIES[1], lw=6, label="cancer / treatment / dose")], loc="lower right")
    a.set(xlabel="how much worse the error gets if this input is scrambled", title="What the takeover-day model relies on")
    save(fig, "6_feature_importance.png")


def plot_learning_curve(df, X, tr, te, tk):
    ylog = np.log(df.T_res.where(df.outcome == "takeover", 1).astype(float).values)
    idx = np.where(tr & tk)[0]
    yt = df.T_res[te & tk].astype(float).values
    sizes = [s for s in (25, 50, 100, 150, 200, len(idx)) if s <= len(idx)]
    rng = np.random.default_rng(0)
    means, sds = [], []
    for s in sizes:
        errs = []
        for rep in range(5 if s < len(idx) else 1):
            sub = rng.choice(idx, size=s, replace=False)
            m = hgb_reg(0.5).fit(X.iloc[sub], ylog[sub])
            errs.append(mean_absolute_error(yt, np.exp(m.predict(X[te & tk]))))
        means.append(np.mean(errs)); sds.append(np.std(errs))
    base_med = df[tr & tk].groupby("regimen").T_res.median()
    base = mean_absolute_error(yt, df[te & tk].regimen.map(base_med).fillna(df[tr & tk].T_res.median()).values)
    fig, a = plt.subplots(figsize=(7, 4.4))
    a.axhline(base, color=SERIES[1], lw=2, ls="--")
    a.text(sizes[-1], base + 0.5, "no-ML guess (median day per regimen)", ha="right", va="bottom", color=INK2, fontsize=8.5)
    a.fill_between(sizes, np.array(means) - np.array(sds), np.array(means) + np.array(sds), color="#cde2fb", lw=0)
    a.plot(sizes, means, "o-", color=SERIES[0], ms=7, label="surrogate model (±1 SD over 5 random subsets)")
    a.annotate(f"{means[-1]:.1f} days", (sizes[-1], means[-1]), xytext=(0, -18), textcoords="offset points", ha="center", color=INK2, fontsize=8.5)
    a.set(xlabel="training runs where takeover happened", ylabel="average error on test runs (days)", ylim=(0, base * 1.25),
          title="More sim runs → better predictions")
    a.legend(loc="lower left")
    save(fig, "7_learning_curve.png")


def plot_confusion(df, X, art, te):
    clf = art["clf"]
    P = np.zeros((te.sum(), 3)); P[:, clf.classes_] = clf.predict_proba(X[te])
    pred = P.argmax(1); true = df.outcome[te].map({o: i for i, o in enumerate(OUTCOMES)}).values
    M = np.zeros((3, 3), int)
    for t, p in zip(true, pred): M[t, p] += 1
    R = M / M.sum(1, keepdims=True)
    from matplotlib.colors import LinearSegmentedColormap
    cmap = LinearSegmentedColormap.from_list("blue", BLUE_RAMP)
    fig, a = plt.subplots(figsize=(5.8, 4.8))
    a.imshow(R, cmap=cmap, vmin=0, vmax=1)
    a.grid(False)
    lab = [OUTCOME_LABEL[o].replace(" by day", "\nby day").replace(" took", "\ntook").replace(" wiped", "\nwiped") for o in OUTCOMES]
    a.set_xticks(range(3), lab, fontsize=8.5); a.set_yticks(range(3), lab, fontsize=8.5)
    for i in range(3):
        for j in range(3):
            a.text(j, i, f"{R[i, j]*100:.0f}%\n({M[i, j]})", ha="center", va="center", fontsize=9,
                   color=SURFACE if R[i, j] > 0.55 else INK)
    for s in a.spines.values(): s.set_visible(False)
    a.set(xlabel="predicted outcome", ylabel="real outcome",
          title=f"Outcome classifier on {te.sum()} test runs ({(pred == true).mean()*100:.0f}% right)")
    save(fig, "8_confusion.png")


def plot_by_regimen(df):
    names = {r: r for r in df.regimen.unique()}
    stats = df.groupby("regimen").apply(lambda s: pd.Series({
        "pct": (s.outcome == "takeover").mean() * 100, "n": len(s),
        "med": s.T_res[s.outcome == "takeover"].median()}), include_groups=False)
    order = stats.sort_values("med", na_position="last").index[::-1]
    fig, a = plt.subplots(figsize=(9, 6.2))
    rng = np.random.default_rng(1)
    for k, reg in enumerate(order):
        t = df[(df.regimen == reg) & (df.outcome == "takeover")].T_res.astype(float).values
        g = group_of(reg)
        a.scatter(t, k + rng.uniform(-0.18, 0.18, len(t)), s=14, color=GROUP_COLOR[g], alpha=0.75, edgecolor="none")
        if len(t): a.plot([np.median(t)] * 2, [k - 0.32, k + 0.32], color=INK, lw=2)
        a.text(183, k, f"{stats.loc[reg, 'pct']:.0f}% of {int(stats.loc[reg, 'n'])}", va="center", fontsize=8, color=INK2)
    a.set_yticks(range(len(order)), [names[r] for r in order], fontsize=8.5)
    a.grid(axis="y", visible=False)
    a.set(xlim=(0, 180), xlabel="takeover day (each dot = one run, black bar = median)",
          title="When resistance takes over, per regimen (right: % of runs it happened in)")
    used = [g for g in GROUP_ORDER if any(group_of(r) == g for r in order)]
    a.legend(handles=[Line2D([], [], marker="o", ls="", color=GROUP_COLOR[g], label=GROUP_LABEL[g]) for g in used],
             loc="upper left", bbox_to_anchor=(0, -0.1), ncol=len(used), fontsize=8)
    fig.subplots_adjust(right=0.86)
    save(fig, "9_takeover_by_regimen.png")


def main(path):
    df, X, art, tr, ca, te, tk = setup(path)
    print(f"making plots from {len(df)} runs ->", PLOTS)
    plot_calibration(df, X, art, te, tk)
    plot_predictions(df, X, art, te, tk)
    plot_resistance_over_time(df)
    plot_first_three_weeks(df)
    plot_resistance_rise(df)
    plot_importance(df, X, art, te, tk)
    plot_learning_curve(df, X, tr, te, tk)
    plot_confusion(df, X, art, te)
    plot_by_regimen(df)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "runs.jsonl")
