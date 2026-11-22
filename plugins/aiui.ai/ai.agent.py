"""AI Agent - the model works on the task and may call the steps linked to its Tools port."""


def run(cfg, ctx):
    return ctx.run_agent(cfg)
