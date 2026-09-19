use crate::errors::CovenantError;
use crate::state::{Covenant, CovenantStatus};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct SettleCovenant<'info> {
    #[account(
        mut,
        seeds = [b"covenant", covenant.user.as_ref(), covenant.constraint_hash.as_ref()],
        bump = covenant.bump,
        constraint = covenant.status == CovenantStatus::Accepted @ CovenantError::NotAccepted,
    )]
    pub covenant: Account<'info, Covenant>,

    pub collateral_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = covenant,
    )]
    pub collateral_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub executor_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<SettleCovenant>) -> Result<()> {
    let verdict = ctx
        .accounts
        .covenant
        .verdict
        .ok_or(CovenantError::VerdictNotReceived)?;

    let user_key = ctx.accounts.covenant.user;
    let constraint_hash = ctx.accounts.covenant.constraint_hash;
    let bump = ctx.accounts.covenant.bump;
    let seeds: &[&[u8]] = &[
        b"covenant",
        user_key.as_ref(),
        constraint_hash.as_ref(),
        &[bump],
    ];
    let signer_seeds = &[seeds];

    let total = ctx.accounts.collateral_vault.amount;

    if verdict {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.collateral_vault.to_account_info(),
                    to: ctx.accounts.executor_token_account.to_account_info(),
                    authority: ctx.accounts.covenant.to_account_info(),
                },
                signer_seeds,
            ),
            total,
        )?;
    } else {
        let compensation = ctx.accounts.covenant.compensation_cap.min(total);
        let remainder = total - compensation;

        if compensation > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    Transfer {
                        from: ctx.accounts.collateral_vault.to_account_info(),
                        to: ctx.accounts.user_token_account.to_account_info(),
                        authority: ctx.accounts.covenant.to_account_info(),
                    },
                    signer_seeds,
                ),
                compensation,
            )?;
        }
        if remainder > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    Transfer {
                        from: ctx.accounts.collateral_vault.to_account_info(),
                        to: ctx.accounts.executor_token_account.to_account_info(),
                        authority: ctx.accounts.covenant.to_account_info(),
                    },
                    signer_seeds,
                ),
                remainder,
            )?;
        }
    }

    let covenant = &mut ctx.accounts.covenant;
    covenant.status = CovenantStatus::Settled;

    msg!("Covenant settled: passed={}", verdict);
    Ok(())
}
