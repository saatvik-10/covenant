use anchor_lang::prelude::*;

#[error_code]
pub enum CovenantError {
    #[msg("Covenant is not open for acceptance")]
    NotOpen,

    #[msg("Covenant has not been accepted yet")]
    NotAccepted,

    #[msg("Deadline has already passed")]
    DeadlinePassed,

    #[msg("Deadline has not been reached yet")]
    DeadlineNotReached,

    #[msg("Only the assigned executor can call this")]
    NotExecutor,

    #[msg("Verdict has not been received from LayerZero yet")]
    VerdictNotReceived,

    #[msg("Covenant is already settled")]
    AlreadySettled,

    #[msg("Constraint hash does not match")]
    ConstraintHashMismatch,

    #[msg("Caller is not the authorized OApp store")]
    UnauthorizedOapp,

    #[msg("Unexpected collateral mint")]
    WrongMint,
}
