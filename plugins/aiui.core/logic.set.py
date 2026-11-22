"""Set variables - stores values that later steps read as vars.<name>."""


def run(cfg, ctx):
    for name, value in (cfg.get("values") or {}).items():
        ctx.vars[name] = value
    return dict(ctx.vars)
