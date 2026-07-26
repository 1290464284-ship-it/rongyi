# Changelog

## [Unreleased]

### Fixed
- Added missing `@ApiProperty` decorators to `CreateFollowUpDto` fields in `clinical/first-exams`
- Added missing `@ApiProperty` decorators to `CreateTreatmentCatalogDto` and `UpdateTreatmentCatalogDto` fields in `clinical/treatments`
- Added missing `@ApiProperty` decorators to `QueryImagingDto` and `UpdateImagingDto` fields in `content/imaging`

### Documentation
- Verified all DTOs in `modules/financial`, `modules/inventory`, `modules/scheduling`, `modules/patients`, `modules/auth`, `modules/clinical`, `modules/communication`, `modules/content`, `modules/equipment`, and `modules/system` have proper Swagger API documentation
- Confirmed `all-exceptions.filter.ts` is properly structured with comprehensive error handling
