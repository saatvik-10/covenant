use anchor_lang::{prelude::*, system_program};
use crate::state::{Covenant, CovenantStatus};
use crate::errors::CovenantError;

#[derive(Accounts)]
pub struct AcceptCovenant<'info> {
    #[account(mut)]
    pub executor: Signer<'info>,

    #[account(
        mut,
        seeds = [b"covenant", covenant.user.as_ref(), covenant.constraint_hash.as_ref()],
        bump = covenant.bump,
        constraint = covenant.status == CovenantStatus::Open @ CovenantError::NotOpen
    )]
    pub covenant: Account<'info, Covenant>,

    #[account(
        mut,
        seeds = [b"covenant", covenant.key().as_ref()] ,
        bump
    )]
    pub collateral_vault: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>
}

pub fn handler(ctx: Context<AcceptCovenant>, collateral_amount: u64) -> Result<()> {
    system_program::transfer (
        CpiContext::new (
            ctx.accounts.system_program.key(),
            system_program::Transfer {
                from:ctx.accounts.executor.to_account_info(),
                to: ctx.accounts.collateral_vault.to_account_info(),
            },
        ),
        collateral_amount,
    )?;

    let covenant = &mut ctx.accounts.covenant;
    covenant.executor = ctx.accounts.executor.key();
    covenant.collateral_amount = collateral_amount;
    covenant.status = CovenantStatus::Accepted;

    msg!("Covenant accepted by {}, collateral={}", covenant.executor, collateral_amount);

    Ok(())
}