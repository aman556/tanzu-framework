import {Injectable} from "@angular/core";
import {Observable} from "rxjs";
import {take} from "rxjs/operators";
import Broker from "./broker";
import {TkgEventType} from "./Messenger";

export interface ImportParams<ClusterParamsType> {
    file: File,
    validator: (nameFile: string, contents: string) => boolean,
    backend: (contents: string ) => Observable<ClusterParamsType>,
    onSuccess: (nameFile: string, payload: ClusterParamsType) => void,
    onFailure: (nameFile: string, err: any) => void
}
@Injectable({
    providedIn: 'root'
})
export class ImportService {
    import( params: ImportParams<any> ) {
        const service = this;  // capture service's 'this' in the outside context to use inside the reader function
        const reader = new FileReader();
        reader.onloadend = function() {
            service.doImport(reader.result, params);
        };
        reader.readAsText(params.file);
    }

    private doImport(argContents: string | ArrayBuffer, params: ImportParams<any>) {
        const contents = '' + argContents;
        if (!params.validator(params.file.name, contents)) {
            return;
        }

        params.backend(contents).pipe(take(1)).subscribe(
            ((payload) => {
                params.onSuccess(params.file.name, payload);
            }),
            ((err) => {
                params.onFailure(params.file.name, err);
            })
        );
    }

    // convenience method for wizards handling an import failure
    publishImportFailure(nameFile: string, err: any) {
        Broker.messenger.publish({
            type: TkgEventType.CONFIG_FILE_IMPORTED,
            payload: 'Error encountered while importing file ' + nameFile + ': ' + err.toString()
        });
    }

    // convenience method for wizards handling an import success
    publishImportSuccess(nameFile: string) {
        Broker.messenger.publish({
            type: TkgEventType.CONFIG_FILE_IMPORTED,
            payload: 'Data imported from file ' + nameFile,
        });
    }
}
