/**
 * Angular Modules
 */
import {Component, OnInit} from '@angular/core';
import {FormControl, Validators} from '@angular/forms';

import {catchError, debounceTime, distinctUntilChanged, takeUntil} from 'rxjs/operators';
import {forkJoin, of} from 'rxjs';

import {APIClient} from '../../../../swagger/api-client.service';
import {StepFormDirective} from '../../wizard/shared/step-form/step-form';
import {TkgEvent, TkgEventType} from '../../../../shared/service/Messenger';
import Broker from 'src/app/shared/service/broker';
import {FormMetaDataStore} from "../../wizard/shared/FormMetaDataStore";
import {AwsField} from "../aws-wizard.constants";
import {NotificationTypes} from "../../../../shared/components/alert-notification/alert-notification.component";

export const AWSAccountParamsKeys = [
    AwsField.PROVIDER_PROFILE_NAME,
    AwsField.PROVIDER_SESSION_TOKEN,
    AwsField.PROVIDER_REGION,
    AwsField.PROVIDER_ACCESS_KEY,
    AwsField.PROVIDER_SECRET_ACCESS_KEY
];

enum CredentialType {
    ONETIME = 'oneTimeCredentials',
    PROFILE = 'credentialProfile'
}

@Component({
    selector: 'app-aws-provider-step',
    templateUrl: './aws-provider-step.component.html',
    styleUrls: ['./aws-provider-step.component.scss']
})
export class AwsProviderStepComponent extends StepFormDirective implements OnInit {
    loading = false;
    authTypeValue: string = CredentialType.PROFILE;

    regions = [];
    profileNames: Array<string> = [];
    validCredentials: boolean = false;
    isProfileChoosen: boolean = false;

    constructor(private apiClient: APIClient) {
        super();
    }

    /**
     * Create the initial form
     */
    private buildForm() {
        this.formGroup.addControl(AwsField.PROVIDER_AUTH_TYPE, new FormControl(this.authTypeValue, []));

        AWSAccountParamsKeys.forEach(key => this.formGroup.addControl(
            key.toString(),
            new FormControl('')
        ));

        this.formGroup.get(AwsField.PROVIDER_REGION).setValidators([
            Validators.required
        ]);

        this.formGroup['canMoveToNext'] = () => {
            return this.formGroup.valid && this.validCredentials;
        }
    }

    /**
     * Set the hidden form field to proper value based on form validity
     * @param valid whether we want the form to be valid
     */
    setValidCredentials(valid) {
        this.validCredentials = valid;

        // call to get region-related data
        if (valid === true) {
            Broker.messenger.publish({
                type: TkgEventType.AWS_GET_EXISTING_VPCS
            });

            Broker.messenger.publish({
                type: TkgEventType.AWS_GET_AVAILABILITY_ZONES
            });

            Broker.messenger.publish({
                type: TkgEventType.AWS_GET_NODE_TYPES
            });
        }
    }

    /**
     * Initialize the form with data from the backend
     * @param credentials AWS credentials
     * @param regions AWS regions
     */
    private initForm() {
        this.initAwsCredentials();
    }

    ngOnInit() {
        super.ngOnInit();

        this.loading = true;
        this.buildForm();
        this.initForm();

        this.formGroup.valueChanges
        .pipe(
            debounceTime(500),
            distinctUntilChanged((prev, curr) => JSON.stringify(prev) === JSON.stringify(curr)),
            takeUntil(this.unsubscribe)
        )
        .subscribe(
            (data) => {
                this.trimCreds(data);
            }
        );

        this.formGroup.get(AwsField.PROVIDER_AUTH_TYPE).valueChanges.pipe(
            distinctUntilChanged((prev, curr) => JSON.stringify(prev) === JSON.stringify(curr)),
            takeUntil(this.unsubscribe)
        ).subscribe(data => {
            this.authTypeValue = data;

            if (this.authTypeValue === CredentialType.ONETIME) {
                this.oneTimeCredentialsSelectedHandler();
            } else if (this.authTypeValue === CredentialType.PROFILE) {
                this.credentialProfileSelectedHandler();
            } else {
                this.disarmField(AwsField.PROVIDER_AUTH_TYPE, true);
            }
        });
        this.authTypeValue = this.getSavedValue(AwsField.PROVIDER_AUTH_TYPE, CredentialType.PROFILE);
        this.setControlValueSafely(AwsField.PROVIDER_AUTH_TYPE, this.authTypeValue);

        Broker.messenger.getSubject(TkgEventType.CONFIG_FILE_IMPORTED)
            .pipe(takeUntil(this.unsubscribe))
            .subscribe((data: TkgEvent) => {
                this.configFileNotification = {
                    notificationType: NotificationTypes.SUCCESS,
                    message: data.payload
                };
                // The file import saves the data to local storage, so we reinitialize this step's form from there
                this.savedMetadata = FormMetaDataStore.getMetaData(this.formName);
                this.initFormWithSavedData();

                // Clear event so that listeners in other provider workflows do not receive false notifications
                Broker.messenger.clearEvent(TkgEventType.CONFIG_FILE_IMPORTED);
            });

        this.initFormWithSavedData();
    }

    trimCreds(data) {
        const trimmedId = data.accessKeyID && data.accessKeyID.replace('\t', '');
        const trimmedKey = data.secretAccessKey && data.secretAccessKey.replace('\t', '');

        if (trimmedId !== data.accessKeyID) {
            this.formGroup.get(AwsField.PROVIDER_ACCESS_KEY).setValue(trimmedId);
        }

        if (trimmedKey !== data.secretAccessKey) {
            this.formGroup.get(AwsField.PROVIDER_SECRET_ACCESS_KEY).setValue(trimmedKey);
        }

        this.validCredentials = false
    }

    private initAwsCredentials() {
        const getRegionObs$ =  this.apiClient.getAWSRegions().pipe(
            catchError(err => of([])),
        );
        const getProfilesObs$ = this.apiClient.getAWSCredentialProfiles().pipe(
            catchError(err => of([])),
        );
        forkJoin([getRegionObs$, getProfilesObs$])
            .pipe(takeUntil(this.unsubscribe))
            .subscribe(
                (next) => {
                    this.regions = next[0].sort();
                    if (this.regions.length === 1) {
                        this.formGroup.get(AwsField.PROVIDER_REGION).setValue(this.regions[0]);
                    }
                    this.profileNames = next[1];
                    if (this.profileNames.length === 1) {
                        this.formGroup.get(AwsField.PROVIDER_PROFILE_NAME).setValue(this.profileNames[0]);
                    }
                },
                () => this.loading = false
            );
    }

    private oneTimeCredentialsSelectedHandler() {
        this.disarmField(AwsField.PROVIDER_PROFILE_NAME, true);
    }

    private credentialProfileSelectedHandler() {
        [
            AwsField.PROVIDER_ACCESS_KEY,
            AwsField.PROVIDER_SECRET_ACCESS_KEY,
            AwsField.PROVIDER_SESSION_TOKEN
        ].forEach(field => this.disarmField(field.toString(), true));
    }

    setAWSCredentialsValuesFromAPI(credentials) {
        // init form values for AWS credentials
        for (const key of AWSAccountParamsKeys) {
            this.setControlValueSafely(key.toString(), credentials[key.toString()]);
        }
    }

    initFormWithSavedData() {
        super.initFormWithSavedData();

        // Use the presence of a saved secret access key to set the access type.
        // (Which is to say: assume CredentialType.PROFILE unless there is a saved secret access key.)
        // NOTE: if there is a real saved access key (from import) we erase it immediately after using it here
        const savedSecretAccessKey = this.getRawSavedValue(AwsField.PROVIDER_SECRET_ACCESS_KEY);
        this.authTypeValue = (savedSecretAccessKey) ? CredentialType.ONETIME : CredentialType.PROFILE;

        this.scrubPasswordField(AwsField.PROVIDER_ACCESS_KEY);
        this.scrubPasswordField(AwsField.PROVIDER_SECRET_ACCESS_KEY);

        // Initializations not needed the first time the form is loaded, but
        // required to re-initialize after form has been used
        this.setValidCredentials(false);
    }

    /**
     * @method verifyCredentials
     * helper method to verify AWS connection credentials
     */
    verifyCredentials() {
        this.loading = true;
        this.errorNotification = '';
        const params = {};
        for (const field of AWSAccountParamsKeys) {
            params[field.toString()] = this.getFieldValue(field);
        }
        this.apiClient.setAWSEndpoint({
            accountParams: params
        })
            .pipe(takeUntil(this.unsubscribe))
            .subscribe(
                (() => {
                    this.errorNotification = '';
                    // Announce that we have a (valid) region
                    Broker.messenger.publish({
                        type: TkgEventType.AWS_REGION_CHANGED,
                        payload: this.getFieldValue(AwsField.PROVIDER_REGION)
                    });
                    Broker.messenger.publish({
                        type: TkgEventType.AWS_GET_OS_IMAGES,
                        payload: {
                            region: this.getFieldValue(AwsField.PROVIDER_REGION)
                        }
                    });
                    this.setValidCredentials(true);
                }),
                ((err) => {
                    const error = err.error.message || err.message || JSON.stringify(err);
                    this.errorNotification = `Invalid AWS credentials: all credentials and region must be valid. ${error}`;
                    this.setValidCredentials(false);
                }),
                (() => {
                    this.loading = false;
                })
            );
    }

    /**
     * Whether to disable "Connect" button
     */
    isConnectDisabled() {
        return !AWSAccountParamsKeys.reduce((accu, key) => this.formGroup.get(key.toString()).valid && accu, true);
    }

    // For use in HTML
    isAuthTypeProfile() {
        const result = this.authTypeValue === CredentialType.PROFILE;
        return result;
    }
}
