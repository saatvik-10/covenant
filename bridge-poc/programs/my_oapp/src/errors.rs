use anchor_lang::prelude::error_code;

#[error_code]
pub enum MyOAppError {
    InvalidMessageType
}

#[error_code]
pub enum CovenantBridgeError {
    #[msg("Message length must be exactly 65 bytes")]
    InvalidMessageLength,
    #[msg("Covenant account does not match derived PDA")]
    WrongCovenant,
}
