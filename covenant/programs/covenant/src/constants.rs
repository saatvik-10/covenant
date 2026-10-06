use anchor_lang::prelude::*;

pub const MY_OAPP_ID: Pubkey = pubkey!("8mKHUrjDP45py3vPY5DCejT3T7FxSHCpsGBVsSDaNfeG");
pub const COLLATERAL_MINT: Pubkey = pubkey!("FdGq4HNQNC8bgWmp54dPitDcCLA6kfz17dDCRgWngEmK");
pub const STORE_SEED: &[u8] = b"Store";
pub const STORE_PDA: Pubkey = pubkey!("Ciq55LhUSLmckazpWRdaTcHHZZNAdQec4Z9aXPc1T3dV");
pub const STORE_BUMP: u8 = 253;

pub fn store_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[STORE_SEED], &MY_OAPP_ID)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derived_store_pda_matches_pinned_address() {
        let (pda, bump) = store_pda();
        assert_eq!(pda, STORE_PDA, "MY_OAPP_ID and STORE_SEED no longer derive STORE_PDA");
        assert_eq!(bump, STORE_BUMP);
    }

    #[test]
    fn collateral_mint_is_not_default() {
        assert_ne!(COLLATERAL_MINT, Pubkey::default());
        assert_ne!(COLLATERAL_MINT, MY_OAPP_ID);
    }
}
