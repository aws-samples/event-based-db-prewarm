// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

export interface RdsInstanceEvent {
    readonly EventCategories: string[]
    readonly SourceType: string
    readonly SourceArn: string
    readonly Date: string
    readonly Message: string
    readonly SourceIdentifier: string
    readonly EventId: string
}