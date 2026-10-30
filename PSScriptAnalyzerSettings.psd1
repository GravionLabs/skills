@{
    Severity     = @('Error', 'Warning')
    ExcludeRules = @(
        # Scripts are CLI tools whose output is for the person at the terminal.
        'PSAvoidUsingWriteHost'
        # Scripts are UTF-8 without BOM on purpose and run on PowerShell 7+, which reads that correctly.
        'PSUseBOMForUnicodeEncodedFile'
        # Internal helper names (Get-GitNames, Clear-CsProjRedundancies) read better in the plural.
        'PSUseSingularNouns'
        # Internal helpers of one-shot scripts; the public entry points support -WhatIf where it matters.
        'PSUseShouldProcessForStateChangingFunctions'
        'PSShouldProcess'
        # Declared parameters are part of the documented script interface and are used from nested scopes or kept for compatibility.
        'PSReviewUnusedParameter'
    )
}
